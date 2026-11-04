/**
 * Fase 6: teste de carga do servidor de jogo — `npm run perf:server -- [opções]`.
 *
 * Sobe um servidor próprio (processo separado, porta 2580, PGlite em memória ou em disco, bot sem
 * pausa, limites de login desligados) e N clientes reais (@colyseus/sdk + o mesmo `NetworkMatch`
 * do navegador) distribuídos em threads. Cada cliente cria conta e personagem e joga partidas
 * inteiras decidindo com um `BotBrain` sobre a visão da própria equipe:
 *
 *   --rooms 50         partidas simultâneas (modo bot: 1 cliente por sala; pvp: 2 clientes por sala)
 *   --mode bot|pvp     bot = cliente × bot do servidor; pvp = dois clientes pareados pela fila
 *   --bot normal       dificuldade do bot do servidor (easy|normal|hard)
 *   --client easy      dificuldade do cérebro dos clientes
 *   --matches 1        partidas por cliente (em sequência)
 *   --disk             PGlite em disco (pasta temporária) em vez de memória
 *   --latency 0 --jitter 0 --loss 0 --churn 0   rede simulada (tools/perf/netsim.ts) entre clientes e servidor
 *   --threads 8        threads de clientes
 *   --json arquivo     grava o relatório completo
 *
 * Mede: tempo de resposta dos comandos no cliente (envio → resultado), duração das partidas,
 * quedas/reconexões, divergências de estado (hash do cliente × servidor, via `ack`), tempo do core,
 * da gravação no banco e da projeção/envio por comando (métricas do servidor), memória e CPU do
 * processo do servidor, e confere o replay de todas as partidas (registro de comandos × snapshots).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

interface WorkerJob {
  serverUrl: string;
  players: number;
  offset: number;
  mode: 'bot' | 'pvp';
  bot: string;
  client: string;
  matches: number;
}

interface MatchResultRow {
  matchId: string;
  ms: number;
  commands: number;
  result: string;
  reconnects: number;
  error?: string;
}

interface WorkerResult {
  joinRetries: number;
  rejoins: number;
  leaveCodes: Record<number, number>;
  rtt: number[];
  matches: MatchResultRow[];
  errors: string[];
}

const CLASSES = ['warrior', 'mage', 'rogue', 'druid'];

async function workerMain(job: WorkerJob): Promise<WorkerResult> {
  if (!process.env.PERF_DEBUG) console.info = () => undefined; // o SDK avisa cada reconexão
  console.warn = () => undefined;
  const { BotBrain, exploreTargets } = await import('@bardurinho/ai');
  const { catalog, patioDasRuinas } = await import('@bardurinho/content');
  const { GameApi } = await import('../../apps/web/src/network/api.js');
  const { joinMatch } = await import('../../apps/web/src/network/connect.js');
  const { NetworkMatch } = await import('../../apps/web/src/network/NetworkMatch.js');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const out: WorkerResult = { rejoins: 0, leaveCodes: {}, joinRetries: 0, rtt: [], matches: [], errors: [] };

  async function player(i: number) {
    const api = new GameApi(job.serverUrl);
    const name = `carga${Date.now().toString(36)}${i}`;
    await api.register(name, 'segredo123', name);
    await api.createCharacter({ name: `Carga ${i}`, classId: CLASSES[i % 4]!, consumables: ['consumable.health_potion', 'consumable.focus_potion'] });
    for (let m = 0; m < job.matches; m++) {
      const t0 = Date.now();
      let matchId = '';
      let reconnects = 0;
      let commands = 0;
      try {
        let roomId: string;
        if (job.mode === 'bot') roomId = (await api.playBot(job.bot)).roomId;
        else {
          await api.joinQueue();
          let st = await api.lobbyStatus();
          const tq = Date.now();
          while (!st.match) {
            if (Date.now() - tq > 60_000) throw new Error('fila sem par');
            await sleep(200);
            st = await api.lobbyStatus();
          }
          roomId = st.match.roomId;
        }
        // Como o cliente web (o lobby tenta de novo a cada segundo): com latência alta a conexão
        // HTTP reaproveitada (keep-alive) pode ter sido fechada pelo servidor no caminho.
        const join = async () => {
          for (let attempt = 0; ; attempt++) {
            try {
              return await joinMatch(job.serverUrl, api.token!, { roomId });
            } catch (err) {
              if (attempt >= 5) throw err;
              out.joinRetries++;
              await sleep(500);
            }
          }
        };
        let j = await join();
        matchId = j.snapshot.matchId;
        let left = false;
        const wire = () => {
          left = false;
          j.room.onDrop(() => reconnects++);
          j.room.onLeave((code: number) => {
            left = true;
            out.leaveCodes[code] = (out.leaveCodes[code] ?? 0) + 1;
          });
        };
        let nm = new NetworkMatch(catalog, j.room, j.snapshot);
        wire();
        const brain = new BotBrain(catalog, nm.team, { difficulty: job.client as 'easy', seed: i * 31 + m, explore: exploreTargets(patioDasRuinas, nm.team) });
        while (nm.state.status !== 'finished') {
          if (Date.now() - t0 > 600_000) throw new Error('partida não terminou em 10 min');
          if (left) {
            // Como o navegador: a reconexão automática desistiu → volta pela sala (assento guardado).
            out.rejoins++;
            j = await join();
            nm = new NetworkMatch(catalog, j.room, j.snapshot);
            wire();
            continue;
          }
          const s = nm.state;
          if (s.status === 'active' && nm.canControl(s.turn.activeUnitId)) {
            const d = brain.decide(s);
            const c0 = performance.now();
            const r = await nm.execute(d.command);
            if (!r.ok && r.error.code === 'DISCONNECTED') {
              await sleep(100); // reconectando: espera, como a interface (botões desabilitados)
              continue;
            }
            out.rtt.push(performance.now() - c0);
            commands++;
            if (!r.ok) {
              brain.rejectedCommand(d.command);
              if (d.command.type === 'END_TURN') await sleep(200);
            }
          } else await sleep(10);
        }
        out.matches.push({ matchId, ms: Date.now() - t0, commands, result: JSON.stringify(nm.state.result), reconnects });
        await j.room.leave().catch(() => undefined);
      } catch (err) {
        out.matches.push({ matchId, ms: Date.now() - t0, commands, result: 'erro', reconnects, error: String(err) });
        const e = err as { code?: unknown; message?: string; stack?: string };
        const where = process.env.PERF_DEBUG ? ` @ ${(e.stack ?? '').split('\n').slice(1, 4).join(' / ')} [partida ${matchId || 'antes de entrar'}, ${commands} comandos]` : '';
        out.errors.push(`${String(err)}${e.code !== undefined ? ` (código ${String(e.code)})` : ''}${e.message ? `: ${e.message}` : ''}${where}`);
      }
    }
  }
  await Promise.all(Array.from({ length: job.players }, (_, k) => player(job.offset + k)));
  return out;
}

if (!isMainThread) {
  workerMain(workerData as WorkerJob).then((r) => parentPort!.postMessage(r), (err) => parentPort!.postMessage({ rejoins: 0, leaveCodes: {}, joinRetries: 0, rtt: [], matches: [], errors: [String(err)] }));
} else {
  const arg = (k: string, d: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : d;
  };
  const flag = (k: string) => process.argv.includes(`--${k}`);
  const rooms = Number(arg('rooms', '50'));
  const mode = arg('mode', 'bot') as 'bot' | 'pvp';
  const players = mode === 'pvp' ? rooms * 2 : rooms;
  const threads = Math.min(Number(arg('threads', '8')), players);
  const latency = Number(arg('latency', '0'));
  const jitter = Number(arg('jitter', '0'));
  const loss = Number(arg('loss', '0'));
  const churn = Number(arg('churn', '0'));
  const port = Number(arg('port', '2580'));
  const dir = flag('disk') ? mkdtempSync(join(tmpdir(), 'bardurinho-carga-')) : null;
  const root = fileURLToPath(new URL('../../', import.meta.url));

  const server = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'apps/server/src/main.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dir ?? 'memory', BOT_DELAY_MS: '0', AUTH_RATE_LIMIT: '0', GAME_LOG: '0', TURN_SECONDS: '60', RECONNECT_SECONDS: '90', JOIN_TIMEOUT_SECONDS: '120' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErr = '';
  server.stderr.on('data', (d) => (serverErr += String(d)));
  const direct = `http://127.0.0.1:${port}`;
  const health = async () => {
    try {
      return ((await (await fetch(`${direct}/health`)).json()) as { ok: boolean }).ok;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 200 && !(await health()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await health())) {
    console.error('servidor não subiu', serverErr);
    process.exit(1);
  }
  let url = direct;
  let sim: Awaited<ReturnType<typeof import('./netsim.js').startNetSim>> | null = null;
  if (latency || jitter || loss || churn) {
    const { startNetSim } = await import('./netsim.js');
    sim = await startNetSim({ port: 0, targetHost: '127.0.0.1', targetPort: port, latencyMs: latency, jitterMs: jitter, lossPct: loss, churnPerMin: churn });
    url = `http://127.0.0.1:${sim.port}`;
  }
  await fetch(`${direct}/debug/metrics/reset`, { method: 'POST' });
  const metrics = async () => (await (await fetch(`${direct}/debug/metrics`)).json()) as {
    series: Record<string, { count: number; avg: number; p50: number; p95: number; p99: number; max: number }>;
    counters: Record<string, number>;
    memory: { rssMb: number; heapUsedMb: number };
    cpu: { user: number; system: number };
    rooms: number;
    divergences: number;
  };
  const cpu0 = (await metrics()).cpu;
  let peakRss = 0;
  let peakHeap = 0;
  let peakRooms = 0;
  const sampler = setInterval(async () => {
    try {
      const m = await metrics();
      peakRss = Math.max(peakRss, m.memory.rssMb);
      peakHeap = Math.max(peakHeap, m.memory.heapUsedMb);
      peakRooms = Math.max(peakRooms, m.rooms);
    } catch {
      /* encerrando */
    }
  }, 1000);

  console.log(`carga: ${rooms} salas simultâneas (${mode}${mode === 'bot' ? `, bot ${arg('bot', 'normal')}` : ''}), ${players} clientes em ${threads} threads, ${arg('matches', '1')} partida(s) cada${sim ? `, rede ${latency}±${jitter} ms, perda ${loss} %, quedas ${churn}/min` : ''}${dir ? ', PGlite em disco' : ', PGlite em memória'}`);
  const t0 = Date.now();
  const per = Math.ceil(players / threads);
  const results: WorkerResult[] = await Promise.all(
    Array.from({ length: threads }, (_, w) => {
      const n = Math.max(0, Math.min(per, players - w * per));
      const job: WorkerJob = { serverUrl: url, players: n, offset: w * per, mode, bot: arg('bot', 'normal'), client: arg('client', 'easy'), matches: Number(arg('matches', '1')) };
      return new Promise<WorkerResult>((resolve) => {
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: job, execArgv: ['--import', 'tsx'] });
        wk.once('message', (r: WorkerResult) => {
          resolve(r);
          void wk.terminate();
        });
        wk.once('error', (err) => resolve({ rejoins: 0, leaveCodes: {}, joinRetries: 0, rtt: [], matches: [], errors: [String(err)] }));
      });
    }),
  );
  const wall = Date.now() - t0;
  clearInterval(sampler);
  const m = await metrics();
  const rtt = results.flatMap((r) => r.rtt).sort((a, b) => a - b);
  const matches = results.flatMap((r) => r.matches);
  const errors = results.flatMap((r) => r.errors);
  const pct = (xs: number[], q: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : 0);
  // No PvP os dois clientes relatam a mesma partida: conta por matchId.
  const finished = [...new Set(matches.filter((x) => x.result !== 'erro').map((x) => x.matchId))];
  const uniqueMatches = new Set(matches.map((x) => x.matchId || Math.random().toString())).size;
  // Replay de todas as partidas (registro de comandos × snapshots do banco).
  let replayOk = 0;
  const replayFail: string[] = [];
  for (const id of finished) {
    const v = (await (await fetch(`${direct}/debug/matches/${id}/verify`)).json()) as { ok: boolean; errors: string[]; mismatches: unknown[] };
    if (v.ok) replayOk++;
    else replayFail.push(`${id}: ${JSON.stringify(v.errors)} ${v.mismatches.length} versões diferentes`);
  }
  const cpuMs = (m.cpu.user + m.cpu.system - cpu0.user - cpu0.system) / 1000;
  const f = (x: number) => x.toFixed(1);
  const report = {
    options: { rooms, mode, players, threads, bot: arg('bot', 'normal'), client: arg('client', 'easy'), matches: Number(arg('matches', '1')), latency, jitter, loss, churn, disk: !!dir },
    wallSeconds: wall / 1000,
    matches: { total: uniqueMatches, finished: finished.length, errors: errors.length, avgSeconds: matches.length ? matches.reduce((s, x) => s + x.ms, 0) / matches.length / 1000 : 0, reconnects: matches.reduce((s, x) => s + x.reconnects, 0), joinRetries: results.reduce((s, r) => s + r.joinRetries, 0), rejoins: results.reduce((s, r) => s + r.rejoins, 0), leaveCodes: results.reduce<Record<string, number>>((acc, r) => { for (const [k, v] of Object.entries(r.leaveCodes)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {}) },
    clientRtt: { count: rtt.length, avg: rtt.reduce((s, x) => s + x, 0) / (rtt.length || 1), p50: pct(rtt, 0.5), p95: pct(rtt, 0.95), p99: pct(rtt, 0.99), max: rtt.at(-1) ?? 0 },
    server: { series: m.series, counters: m.counters, peakRssMb: peakRss, peakHeapMb: peakHeap, peakRooms, cpuSeconds: cpuMs / 1000, cpuPctOfOneCore: (cpuMs / wall) * 100, divergences: m.counters['desync.divergences'] ?? 0, acks: m.counters['desync.acks'] ?? 0 },
    replay: { ok: replayOk, failed: replayFail },
    netsim: sim?.stats ?? null,
    errors: [...new Set(errors)].slice(0, 20),
  };
  const s = m.series;
  console.log(`\n${report.matches.finished}/${report.matches.total} partidas terminadas em ${f(wall / 1000)} s (média ${f(report.matches.avgSeconds)} s por partida); ${errors.length} erros; ${report.matches.reconnects} quedas/reconexões; ${report.matches.joinRetries} novas tentativas de entrar; ${report.matches.rejoins} reentradas pela sala (saídas: ${JSON.stringify(report.matches.leaveCodes)})`);
  console.log(`comando no cliente (envio → resultado): média ${f(report.clientRtt.avg)} ms · p50 ${f(report.clientRtt.p50)} · p95 ${f(report.clientRtt.p95)} · p99 ${f(report.clientRtt.p99)} · máx ${f(report.clientRtt.max)} (${rtt.length} comandos)`);
  for (const k of ['command.total', 'core.applyCommand', 'core.stateHash', 'db.saveAccepted', 'net.projectAndSend']) {
    const x = s[k];
    if (x) console.log(`servidor ${k.padEnd(20)} média ${f(x.avg)} ms · p95 ${f(x.p95)} · p99 ${f(x.p99)} · máx ${f(x.max)} (${x.count})`);
  }
  console.log(`servidor: pico ${peakRooms} salas, RSS ${f(peakRss)} MB (heap ${f(peakHeap)} MB), CPU ${f(report.server.cpuPctOfOneCore)} % de um núcleo; comandos aceitos ${m.counters['commands.accepted'] ?? 0}, recusados ${m.counters['commands.rejected'] ?? 0}`);
  console.log(`desync: ${report.server.divergences} divergências em ${report.server.acks} confirmações (ack) · replay ${replayOk}/${finished.length} idênticos`);
  if (sim) console.log(`rede: ${sim.stats.connections} conexões TCP (${sim.stats.webSockets} WebSocket), ${sim.stats.killed} cortadas, ${sim.stats.lossEvents} "perdas"`);
  if (report.errors.length) console.log('erros:', report.errors);
  if (replayFail.length) console.log('replay com falha:', replayFail.slice(0, 5));
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify(report, null, 2));
  await sim?.close();
  server.kill();
  if (dir) setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
  const ok = errors.length === 0 && report.server.divergences === 0 && replayFail.length === 0 && finished.length === uniqueMatches;
  setTimeout(() => process.exit(ok ? 0 : 1), 800);
}
