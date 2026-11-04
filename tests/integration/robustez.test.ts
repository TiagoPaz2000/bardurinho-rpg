/**
 * Fase 6 — robustez do servidor pela rede (Colyseus + HTTP no mesmo processo, PGlite):
 * limite de login, corrida na loja, mensagens enormes/desconhecidas/flood no WebSocket,
 * pareado que nunca entra (cancelamento + volta à fila), abandono = derrota e partidas
 * encerradas como `aborted` depois de reiniciar o servidor.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import { PROTOCOL_VERSION } from '@bardurinho/protocol';
import { createGameServer, type GameServer } from '../../apps/server/src/app.js';
import { GameApi } from '../../apps/web/src/network/api.js';
import { joinMatch } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';

let gs: GameServer;
beforeAll(async () => {
  gs = await createGameServer({
    port: 0,
    dataDir: 'memory',
    log: false,
    turnSeconds: 60,
    reconnectSeconds: 1,
    abandonSeconds: 60,
    botDelayMs: 0,
    joinTimeoutSeconds: 1.5,
    rateLimit: { loginFailuresPerUser: 3, loginPerIpPerMinute: 1000, registerPerIpPer10Min: 1000 },
  });
}, 60_000);
afterAll(async () => {
  await gs?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | Promise<T>, ms = 10000, what = 'condição'): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`);
    await sleep(25);
  }
}
let n = 0;
async function player(server = gs, classId = 'warrior') {
  const api = new GameApi(server.url);
  const username = `rob${Date.now().toString(36)}${n++}`;
  await api.register(username, 'segredo123', username);
  await api.createCharacter({ name: `Herói ${n}`, classId, consumables: [] });
  return { api, username };
}
const healthy = async () => ((await (await fetch(gs.url + '/health')).json()) as { ok: boolean }).ok;
const post = (path: string, body: unknown, token?: string) =>
  fetch(gs.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

describe('Fase 6 — autenticação', () => {
  it('login: depois de 3 senhas erradas o usuário fica bloqueado (429), mesmo com a senha certa', async () => {
    const { username } = await player();
    for (let i = 0; i < 3; i++) expect((await post('/auth/login', { username, password: 'errada!!' })).status).toBe(401);
    const blocked = await post('/auth/login', { username, password: 'segredo123' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Outro usuário não é afetado.
    const other = await player();
    expect((await post('/auth/login', { username: other.username, password: 'segredo123' })).status).toBe(200);
  }, 30_000);

  it('corpo JSON enorme ou inválido é recusado sem derrubar o servidor', async () => {
    const huge = await fetch(gs.url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(100_000) }).catch(() => null);
    expect(huge === null || huge.status >= 400).toBe(true);
    expect((await fetch(gs.url + '/auth/login', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect(await healthy()).toBe(true);
  }, 30_000);
});

describe('Fase 6 — loja: gasto duplo e corrida', () => {
  it('20 compras simultâneas do mesmo item: só uma cobra; mesmo requestId repetido: uma compra', async () => {
    const { api } = await player();
    const ids = Array.from({ length: 20 }, (_, i) => `corrida-${Date.now()}-${i}`);
    const rs = await Promise.all(ids.map((id) => api.buy('color.gold', id).catch((e: Error) => ({ ok: false, error: e.message }))));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const same = `mesmo-${Date.now()}`;
    const rs2 = await Promise.all(Array.from({ length: 10 }, () => api.buy('color.obsidian', same).catch((e: Error) => ({ ok: false, duplicate: false, error: e.message }))));
    expect(rs2.filter((r) => r.ok)).toHaveLength(10); // todas devolvem a mesma compra concluída…
    expect(rs2.filter((r) => 'duplicate' in r && !r.duplicate)).toHaveLength(1); // …mas só uma foi feita
    const me = await api.me();
    expect(me.account.coins).toBe(0); // 100 − 50 − 50
    const ledger = await gs.services.profiles.ledger(me.account.id);
    expect(ledger.filter((l) => l.reason === 'purchase')).toHaveLength(2);
  }, 30_000);

  it('compras simultâneas acima do saldo: o saldo nunca fica negativo', async () => {
    const { api } = await player();
    const products = ['color.gold', 'color.obsidian', 'color.violet', 'portrait.lion', 'frame.silver', 'aura.arcane'];
    const rs = await Promise.all(products.map((p, i) => api.buy(p, `saldo-${Date.now()}-${i}`).catch(() => ({ ok: false }))));
    const me = await api.me();
    expect(me.account.coins).toBeGreaterThanOrEqual(0);
    const spent = 100 - me.account.coins;
    const prices: Record<string, number> = { 'color.gold': 50, 'color.obsidian': 50, 'color.violet': 50, 'portrait.lion': 80, 'frame.silver': 60, 'aura.arcane': 120 };
    expect(rs.reduce((sum, r, i) => sum + (r.ok ? prices[products[i]!]! : 0), 0)).toBe(spent);
  }, 30_000);
});

describe('Fase 6 — WebSocket hostil', () => {
  it('mensagem > 4 KB derruba só a conexão; tipo desconhecido é ignorado; flood desconecta', async () => {
    const { api } = await player();
    const { roomId } = await api.playBot('easy');
    const j = await joinMatch(gs.url, api.token!, { roomId });
    const nm = new NetworkMatch(catalog, j.room, j.snapshot);
    await waitFor(() => nm.state.status === 'active', 10000, 'início');
    // Tipo desconhecido e payloads estranhos: nada acontece.
    j.room.send('desconhecido', { a: 1 });
    j.room.send('ack', { version: 'x', hash: 42 });
    j.room.send('command', null);
    await sleep(200);
    expect(j.room.connection.isOpen).toBe(true);
    // Outra partida em paralelo continua de pé enquanto esta conexão é derrubada.
    const other = await player();
    const o = await other.api.playBot('easy');
    const jo = await joinMatch(gs.url, other.api.token!, { roomId: o.roomId });
    let closed = null as number | null;
    j.room.onLeave((code: number) => (closed = code));
    j.room.send('command', { type: 'END_TURN', actorId: 'unit-a1', protocolVersion: PROTOCOL_VERSION, commandId: 'big', junk: 'x'.repeat(10_000) });
    await waitFor(() => closed !== null || !j.room.connection.isOpen, 5000, 'queda pela mensagem enorme');
    expect(await healthy()).toBe(true);
    expect(jo.room.connection.isOpen).toBe(true);
    // Flood: muito acima de 120 mensagens/s → desconectado (4002).
    let floodCode = null as number | null;
    jo.room.onLeave((code: number) => (floodCode = code));
    for (let i = 0; i < 400; i++) jo.room.send('ack', { version: 0, hash: 'x' });
    await waitFor(() => floodCode !== null, 5000, 'desconexão por flood');
    expect(floodCode).toBe(4002);
    expect(await healthy()).toBe(true);
  }, 30_000);
});

describe('Fase 6 — lacunas das Fases 3–5', () => {
  it('pareado que nunca entra: a partida é cancelada no prazo e quem entrou volta à fila', async () => {
    const p1 = await player();
    const p2 = await player();
    await p1.api.joinQueue();
    await p2.api.joinQueue();
    const st = await waitFor(async () => (await p1.api.lobbyStatus()).match, 5000, 'partida montada');
    const j = await joinMatch(gs.url, p1.api.token!, { roomId: st.roomId });
    let code = null as number | null;
    j.room.onLeave((c: number) => (code = c));
    const matchId = j.snapshot.matchId;
    // p2 nunca entra (fechou a aba).
    await waitFor(() => code !== null, 6000, 'cancelamento');
    expect(code).toBe(4100);
    const s1 = await p1.api.lobbyStatus();
    expect(s1.queue).not.toBeNull();
    expect(s1.match).toBeNull();
    const s2 = await p2.api.lobbyStatus();
    expect(s2.queue).toBeNull();
    expect(s2.match).toBeNull();
    expect((await gs.services.matches.get(matchId))!.status).toBe('cancelled');
    await p1.api.leaveQueue();
  }, 30_000);

  it('abandono: quem sai e não volta dentro da reserva perde por desistência', async () => {
    const { api } = await player();
    const { roomId } = await api.playBot('easy');
    const j = await joinMatch(gs.url, api.token!, { roomId });
    const nm = new NetworkMatch(catalog, j.room, j.snapshot);
    await waitFor(() => nm.state.status === 'active', 10000, 'início');
    const matchId = j.snapshot.matchId;
    await j.room.leave();
    const m = await waitFor(async () => {
      const row = await gs.services.matches.get(matchId);
      return row?.status === 'finished' ? row : null;
    }, 8000, 'derrota por abandono');
    expect(m.result).toMatchObject({ kind: 'victory', winnerTeam: 'B', reason: 'surrender' });
    const reward = await waitFor(() => api.reward(matchId).catch(() => null), 5000, 'recompensa');
    expect(reward.outcome).toBe('defeat');
    expect(reward.stats.surrendered).toBe(true); // abandono = desistência: 0 moedas, não conta como concluída
    expect(reward.coins).toBe(0);
  }, 30_000);

  it('quem volta dentro da reserva não perde', async () => {
    const { api } = await player();
    const { roomId } = await api.playBot('easy');
    const j = await joinMatch(gs.url, api.token!, { roomId });
    const nm0 = new NetworkMatch(catalog, j.room, j.snapshot);
    await waitFor(() => nm0.state.status === 'active', 10000, 'início');
    await j.room.leave();
    await sleep(300);
    const back = await joinMatch(gs.url, api.token!, { roomId });
    await sleep(1500);
    expect((await gs.services.matches.get(back.snapshot.matchId))!.status).not.toBe('finished');
    await back.room.leave();
  }, 30_000);

  it('reiniciar o servidor: as partidas abertas viram "aborted" e o lobby não manda para a sala perdida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardurinho-restart-'));
    try {
      const first = await createGameServer({ port: 0, dataDir: dir, log: false, botDelayMs: 0, reconnectSeconds: 30 });
      const { api, username } = await player(first);
      const { roomId } = await api.playBot('easy');
      const j = await joinMatch(first.url, api.token!, { roomId });
      const matchId = j.snapshot.matchId;
      await waitFor(async () => (await first.services.matches.get(matchId))?.status === 'active', 10000, 'partida ativa');
      j.room.connection.close();
      await first.close();
      const second = await createGameServer({ port: 0, dataDir: dir, log: false });
      try {
        expect((await second.services.matches.get(matchId))!.status).toBe('aborted');
        const api2 = new GameApi(second.url);
        await api2.login(username, 'segredo123');
        const st = await api2.lobbyStatus();
        expect(st.match).toBeNull();
        expect(st.queue).toBeNull();
        expect((await api2.playBot('easy')).roomId).toBeTruthy(); // pode jogar de novo
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

// No fim do arquivo: um segundo servidor no mesmo processo troca os serviços globais da sala (MatchRoom.services / matchMaker).
describe('Fase 6 — rotas de depuração', () => {
  it('fora do modo dev, /debug (estado oficial, relatório de bug, métricas) não existe', async () => {
    const prod = await createGameServer({ port: 0, dataDir: 'memory', log: false, dev: false, devAccounts: [] });
    try {
      for (const path of ['/debug/matches', '/debug/metrics', '/debug/matches/x/export']) expect((await fetch(prod.url + path)).status).toBe(404);
      expect((await fetch(prod.url + '/health')).status).toBe(200);
    } finally {
      await prod.close();
    }
  }, 30_000);
});
