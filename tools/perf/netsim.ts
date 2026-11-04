/**
 * Fase 6: simulador de rede — proxy TCP entre clientes e o servidor de jogo (HTTP + WebSocket
 * passam por ele) com latência, variação (jitter), "perda" e queda de conexões (churn).
 *
 *   npm run netsim -- [--port 2667] [--target 127.0.0.1:2567] [--latency 120] [--jitter 40] [--loss 2] [--churn 1]
 *   → abra o cliente com ?server=http://127.0.0.1:2667 (o servidor precisa aceitar a origem no CORS).
 *
 * - latência = ida e volta (metade em cada sentido) + jitter uniforme, **mantendo a ordem** dos
 *   bytes (é TCP: nada chega fora de ordem);
 * - perda (%): TCP não perde pacotes para a aplicação — a perda aparece como retransmissão; aqui
 *   cada pedaço tem `loss`% de chance de atrasar mais 200–400 ms (e segura os seguintes);
 * - churn (quedas por minuto por conexão): a conexão é cortada no meio (as duas pontas), como
 *   um Wi-Fi que cai — o SDK do Colyseus reconecta sozinho e o servidor guarda a vaga.
 */
import { createConnection, createServer, type Socket } from 'node:net';

export interface NetSimOptions {
  port: number;
  targetHost: string;
  targetPort: number;
  latencyMs: number;
  jitterMs: number;
  lossPct: number;
  churnPerMin: number;
  /** Só corta conexões WebSocket (as requisições HTTP curtas passam). */
  churnWebSocketOnly?: boolean;
}

export interface NetSim {
  port: number;
  stats: { connections: number; webSockets: number; open: number; killed: number; bytes: number; delayedChunks: number; lossEvents: number };
  close(): Promise<void>;
}

export function startNetSim(o: NetSimOptions): Promise<NetSim> {
  const stats = { connections: 0, webSockets: 0, open: 0, killed: 0, bytes: 0, delayedChunks: 0, lossEvents: 0 };
  const sockets = new Set<Socket>();
  const oneWay = () => o.latencyMs / 2 + Math.random() * o.jitterMs;
  /** Encaminha `from` → `to` com atraso, preservando a ordem. */
  /** Último instante agendado de entrega (por conexão), para fechar só depois de entregar tudo. */
  const pending = new WeakMap<Socket, number>();
  const pipeDelayed = (from: Socket, to: Socket) => {
    // Fila única por sentido com um só temporizador: vários setTimeout com prazos próximos não
    // garantem a ordem entre si (corrompia o MessagePack do WebSocket).
    const queue: Array<{ at: number; chunk: Buffer | null }> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = 0;
    const flush = () => {
      timer = null;
      const now = Date.now();
      while (queue.length && queue[0]!.at <= now) {
        const { chunk } = queue.shift()!;
        if (to.destroyed) continue;
        if (chunk) to.write(chunk);
        else to.end();
      }
      if (queue.length) timer = setTimeout(flush, Math.max(0, queue[0]!.at - Date.now()));
    };
    const enqueue = (at: number, chunk: Buffer | null) => {
      queue.push({ at, chunk });
      pending.set(to, at);
      if (!timer) timer = setTimeout(flush, Math.max(0, queue[0]!.at - Date.now()));
    };
    from.on('data', (chunk: Buffer) => {
      stats.bytes += chunk.length;
      let at = Date.now() + oneWay();
      if (o.lossPct > 0 && Math.random() * 100 < o.lossPct) {
        stats.lossEvents++;
        at += 200 + Math.random() * 200;
      }
      at = Math.max(at, lastAt);
      lastAt = at;
      stats.delayedChunks++;
      enqueue(at, chunk);
    });
    from.on('end', () => enqueue(Math.max(lastAt, Date.now()), null));
  };
  const server = createServer((client) => {
    stats.connections++;
    stats.open++;
    const upstream = createConnection({ host: o.targetHost, port: o.targetPort });
    sockets.add(client);
    sockets.add(upstream);
    let isWs = false;
    // O pedido de upgrade pode vir numa conexão HTTP reaproveitada (keep-alive do undici):
    // confere cada pedaço até achar o upgrade.
    const onData = (chunk: Buffer) => {
      if (!/upgrade:\s*websocket/i.test(chunk.toString('latin1', 0, Math.min(chunk.length, 2048)))) return;
      isWs = true;
      stats.webSockets++;
      client.off('data', onData);
    };
    client.on('data', onData);
    pipeDelayed(client, upstream);
    pipeDelayed(upstream, client);
    const destroy = () => {
      if (sockets.delete(client)) stats.open--;
      sockets.delete(upstream);
      clearInterval(churn);
      client.destroy();
      upstream.destroy();
    };
    // Uma ponta fechou: entrega o que ainda está "no fio" antes de fechar a outra (sem isso a
    // resposta HTTP/WebSocket chegava truncada).
    const cleanup = () => {
      const until = Math.max(pending.get(client) ?? 0, pending.get(upstream) ?? 0);
      setTimeout(destroy, Math.max(0, until - Date.now()) + 20);
    };
    client.on('error', destroy);
    upstream.on('error', destroy);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
    // Queda aleatória (processo de Poisson aproximado, verificado a cada segundo).
    const churn = setInterval(() => {
      if (o.churnPerMin <= 0 || (o.churnWebSocketOnly !== false && !isWs)) return;
      if (Math.random() < o.churnPerMin / 60) {
        stats.killed++;
        destroy();
      }
    }, 1000);
  });
  return new Promise((resolve) => {
    server.listen(o.port, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        stats,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

// CLI: npm run netsim -- …
if (process.argv[1] && /netsim\.ts$/.test(process.argv[1])) {
  const arg = (k: string, d: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
  };
  const [host, port] = arg('target', '127.0.0.1:2567').split(':');
  const sim = await startNetSim({
    port: Number(arg('port', '2667')),
    targetHost: host!,
    targetPort: Number(port),
    latencyMs: Number(arg('latency', '120')),
    jitterMs: Number(arg('jitter', '40')),
    lossPct: Number(arg('loss', '0')),
    churnPerMin: Number(arg('churn', '0')),
  });
  console.log(`netsim: 127.0.0.1:${sim.port} → ${host}:${port} (latência ${arg('latency', '120')} ms ± ${arg('jitter', '40')}, perda ${arg('loss', '0')} %, quedas ${arg('churn', '0')}/min por conexão WebSocket)`);
  setInterval(() => console.log(`  conexões ${sim.stats.connections} (abertas ${sim.stats.open}, cortadas ${sim.stats.killed}), ${(sim.stats.bytes / 1024).toFixed(0)} KB`), 10_000);
}
