/**
 * Fase 7 — teste externo no servidor (mesmo processo, PGlite em memória, **configuração de
 * produção**: sem /debug, cadastro só com convite, teste externo ligado, painel com token,
 * cliente estático na mesma porta): convites, telemetria com consentimento e anonimização,
 * revanche (bot e PvP), pesquisa, relatório de bug com o anexo da partida, painel /admin e
 * as métricas do relatório.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import { BUG_REPORT_FORMAT, parseTelemetryBatch } from '@bardurinho/protocol';
import { createGameServer, type GameServer } from '../../apps/server/src/app.js';
import { computePlaytestMetrics, renderMarkdown, type PlaytestMetrics } from '../../apps/server/src/modules/analytics/playtestMetrics.js';
import { GameApi } from '../../apps/web/src/network/api.js';
import { joinMatch } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';

const ADMIN = 'token-de-admin-de-teste';
let gs: GameServer;
const staticDir = join(tmpdir(), `bardurinho-static-${Date.now()}`);

beforeAll(async () => {
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>cliente de teste</title>');
  writeFileSync(join(staticDir, 'build.json'), '{"version":"x"}');
  gs = await createGameServer({
    port: 0,
    dataDir: 'memory',
    log: false,
    dev: false,
    devAccounts: [],
    playtest: true,
    registration: 'invite',
    inviteCodes: [{ code: 'TESTE-GRUPO', maxUses: 30 }, { code: 'TESTE-UNICO', maxUses: 1 }],
    adminToken: ADMIN,
    staticDir,
    turnSeconds: 30,
    reconnectSeconds: 5,
    abandonSeconds: 60,
    botDelayMs: 0,
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
const post = (path: string, body: unknown, token?: string) =>
  fetch(`${gs.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

let n = 0;
async function newPlayer(classId = 'warrior') {
  const api = new GameApi(gs.url);
  const username = `teste${Date.now().toString(36)}${n++}`;
  await api.register(username, 'segredo123', `Testador ${n}`, 'teste-grupo');
  await api.createCharacter({ name: `Herói ${n}`, classId });
  return { api, username, accountId: (await api.me()).account.id };
}

/** Entra na partida montada e desiste assim que ela começa (partida curta terminada). */
async function playAndSurrender(api: GameApi, roomId: string) {
  const joined = await joinMatch(gs.url, api.token!, { roomId });
  const nm = new NetworkMatch(catalog, joined.room, joined.snapshot);
  await waitFor(() => nm.state.status === 'active', 8000, 'início');
  return { joined, nm };
}
async function surrender(nm: NetworkMatch) {
  const mine = Object.values(nm.state.units).find((u) => u.alive && nm.canControl(u.id))!;
  const r = await nm.execute({ type: 'SURRENDER', actorId: mine.id });
  expect(r.ok).toBe(true);
  await waitFor(() => nm.state.status === 'finished', 8000, 'fim');
}

describe('Fase 7 — distribuição (configuração de produção)', () => {
  it('sem rotas de debug; /playtest/config; cliente estático na mesma porta (gzip)', async () => {
    expect((await fetch(`${gs.url}/debug/matches`)).status).toBe(404);
    expect((await fetch(`${gs.url}/debug/metrics`)).status).toBe(404);
    const cfg = await new GameApi(gs.url).playtestConfig();
    expect(cfg).toMatchObject({ playtest: true, registration: 'invite', build: { version: '0.7.0' }, contentVersion: catalog.contentVersion });
    const home = await fetch(`${gs.url}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(home.status).toBe(200);
    expect(home.headers.get('content-encoding')).toBe('gzip');
    expect(await home.text()).toContain('cliente de teste');
    expect((await fetch(`${gs.url}/../package.json`)).status).not.toBe(200);
    expect((await fetch(`${gs.url}/health`)).ok).toBe(true);
  });

  it('cadastro só com código de convite válido; usos contados; código esgotado é recusado', async () => {
    const api = new GameApi(gs.url);
    await expect(api.register('semconvite', 'segredo123')).rejects.toMatchObject({ status: 403 });
    await expect(api.register('convitefalso', 'segredo123', undefined, 'NAO-EXISTE')).rejects.toThrow(/convite/);
    await api.register('convite_unico', 'segredo123', undefined, 'teste-unico');
    await expect(new GameApi(gs.url).register('convite_unico2', 'segredo123', undefined, 'TESTE-UNICO')).rejects.toThrow(/esgotado/);
    // O usuário recusado não foi criado (transação desfeita) e o uso não foi contado duas vezes.
    expect((await gs.services.db.query('SELECT 1 FROM accounts WHERE username = $1', ['convite_unico2'])).length).toBe(0);
    const inv = (await gs.services.playtest.invites()).find((i) => i.code === 'TESTE-UNICO')!;
    expect(inv).toMatchObject({ uses: 1, maxUses: 1 });
    const row = await gs.services.db.query<{ invite_code: string; analytics_id: string }>('SELECT invite_code, analytics_id FROM accounts WHERE username = $1', ['convite_unico']);
    expect(row[0]).toMatchObject({ invite_code: 'TESTE-UNICO' });
    expect(row[0]!.analytics_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Fase 7 — telemetria, pesquisa e bug', () => {
  it('telemetria só com consentimento; lote validado; anônima (id aleatório, sem usuário)', async () => {
    expect(parseTelemetryBatch({ consent: false, clientId: 'abcdefgh12', sessionId: 'abcdefgh12', events: [{ type: 'heartbeat', t: Date.now() }] }).ok).toBe(false);
    expect((await post('/telemetry/events', { clientId: 'abcdefgh12', sessionId: 'sess12345', events: [{ type: 'heartbeat' }] })).status).toBe(400);
    const p = await newPlayer();
    const batch = {
      consent: true,
      clientId: 'cliente-teste-1',
      sessionId: 'sessao-teste-1',
      build: 'v0.7.0 · teste',
      events: [
        { type: 'session_start', t: Date.now(), props: { w: 1280, h: 720 } },
        { type: 'screen_view', t: Date.now(), props: { screen: 'lobby', senha: { x: 1 }, 'chave inválida': 1 } },
        { type: 'tipo_inventado', t: Date.now() },
        { type: 'match_ui', t: Date.now(), matchId: 'm-1', props: { aimCancel: 2, rejected: 1, turns: 3, turnAvgS: 12.5, partial: false } },
      ],
    };
    const r = await post('/telemetry/events', batch, p.api.token!);
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ accepted: 3 });
    const rows = await gs.services.db.query<Record<string, unknown>>("SELECT * FROM analytics_events WHERE session_id = 'sessao-teste-1' ORDER BY id");
    expect(rows.map((x) => x.type)).toEqual(['session_start', 'screen_view', 'match_ui']);
    expect(rows[1]!.props).toEqual({ screen: 'lobby' });
    const aid = (await gs.services.db.query<{ analytics_id: string }>('SELECT analytics_id FROM accounts WHERE id = $1', [p.accountId]))[0]!.analytics_id;
    expect(rows.every((x) => x.analytics_id === aid)).toBe(true);
    // Nenhuma coluna de análise guarda usuário/nome/IP/token.
    const cols = await gs.services.db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name IN ('analytics_events', 'feedback_surveys', 'bug_reports')");
    expect(cols.map((c) => c.column_name).filter((c) => /^(username|display_name|name|ip|ip_address|token|password_hash|account_id)$/.test(c))).toEqual([]);
    // Consentimento gravado na conta.
    expect((await p.api.setConsent(true)).ok).toBe(true);
    // Lote grande demais / corpo enorme.
    expect((await post('/telemetry/events', { ...batch, events: Array.from({ length: 51 }, () => ({ type: 'heartbeat', t: Date.now() })) })).status).toBe(400);
  });

  it('pesquisa pós-partida (uma por partida) e bug com o registro da partida anexado', async () => {
    const p = await newPlayer('mage');
    const { roomId } = await p.api.playBot('easy');
    const { joined, nm } = await playAndSurrender(p.api, roomId);
    await surrender(nm);
    await expect(p.api.submitSurvey({ matchId: nm.matchId, fun: 9 })).rejects.toThrow(/diversão/);
    const other = await newPlayer();
    await expect(other.api.submitSurvey({ matchId: nm.matchId, fun: 4 })).rejects.toMatchObject({ status: 404 });
    const s = await p.api.submitSurvey({ matchId: nm.matchId, fun: 4, clarity: 3, camera: 5, balance: -1, botRating: 2, playAgain: 'sim', comment: 'Gostei\u0007 do fogo no óleo', build: 'v0.7.0 · teste' });
    expect(s).toEqual({ ok: true, duplicate: false });
    expect(await p.api.submitSurvey({ matchId: nm.matchId, fun: 1 })).toEqual({ ok: true, duplicate: true });
    const row = (await gs.services.db.query<Record<string, unknown>>('SELECT * FROM feedback_surveys WHERE match_id = $1', [nm.matchId]))[0]!;
    expect(row).toMatchObject({ mode: 'bot', bot_difficulty: 'easy', outcome: 'defeat', class_id: 'mage', fun: 4, balance: -1, bot_rating: 2, play_again: 'sim', comment: 'Gostei do fogo no óleo' });
    const bug = await p.api.reportBug({ matchId: nm.matchId, category: 'camera', description: 'A câmera atravessou o muro', client: { w: 1280 } });
    expect(bug).toMatchObject({ ok: true, attached: true });
    // Partida de outra pessoa: o bug fica sem anexo (não vaza o registro).
    expect(await other.api.reportBug({ matchId: nm.matchId, category: 'regras', description: 'teste de anexo alheio' })).toMatchObject({ attached: false });
    await expect(p.api.reportBug({ category: 'outro', description: 'x' })).rejects.toThrow(/Descreva/);
    // O anexo é o relatório da Fase 6 (vira cenário de regressão), baixado pelo painel.
    const res = await fetch(`${gs.url}/admin/api/bugs/${bug.id}/export`, { headers: { Authorization: `Bearer ${ADMIN}` } });
    const report = (await res.json()) as { format: string; matchId: string; commands: unknown[] };
    expect(report).toMatchObject({ format: BUG_REPORT_FORMAT, matchId: nm.matchId });
    expect(report.commands.length).toBeGreaterThan(1);
    await joined.room.leave();
  }, 60_000);
});

describe('Fase 7 — revanche', () => {
  it('contra o bot: partida nova na mesma dificuldade, ligada à anterior', async () => {
    const p = await newPlayer('rogue');
    const { roomId } = await p.api.playBot('normal');
    const { joined, nm } = await playAndSurrender(p.api, roomId);
    await expect(p.api.rematch(nm.matchId)).rejects.toMatchObject({ status: 409 }); // ainda em andamento
    await surrender(nm);
    const r = await p.api.rematch(nm.matchId);
    expect(r.status).toBe('created');
    const st = await p.api.lobbyStatus();
    expect(st.match).toMatchObject({ mode: 'bot' });
    await joined.room.leave();
    const j2 = await joinMatch(gs.url, p.api.token!, { roomId: st.match!.roomId });
    const m2 = new NetworkMatch(catalog, j2.room, j2.snapshot);
    const row = (await gs.services.db.query<{ rematch_of: string; bot_difficulty: string }>('SELECT rematch_of, bot_difficulty FROM matches WHERE id = $1', [m2.matchId]))[0]!;
    expect(row).toEqual({ rematch_of: nm.matchId, bot_difficulty: 'normal' });
    await waitFor(() => m2.state.status === 'active', 8000, 'revanche começou');
    await surrender(m2);
    await j2.room.leave();
    // Quem não jogou a partida não pede revanche dela.
    await expect((await newPlayer()).api.rematch(nm.matchId)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it('PvP: o primeiro pede (convite de revanche), o segundo pede também → partida nova para os dois', async () => {
    const a = await newPlayer('warrior');
    const b = await newPlayer('druid');
    await a.api.joinQueue();
    await b.api.joinQueue();
    const roomId = (await a.api.lobbyStatus()).match!.roomId;
    const [A, B] = await Promise.all([playAndSurrender(a.api, roomId), playAndSurrender(b.api, roomId)]);
    await surrender(A.nm);
    await waitFor(() => B.nm.state.status === 'finished', 8000, 'fim no B');
    const ra = await a.api.rematch(A.nm.matchId);
    expect(ra).toMatchObject({ status: 'waiting' });
    expect(await a.api.rematch(A.nm.matchId)).toMatchObject({ status: 'waiting' }); // repetir não duplica
    const inc = (await b.api.lobbyStatus()).invites.incoming;
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ rematchOf: A.nm.matchId });
    const rb = await b.api.rematch(B.nm.matchId);
    expect(rb.status).toBe('created');
    const sa = await a.api.lobbyStatus();
    const sb = await b.api.lobbyStatus();
    expect(sa.match?.roomId).toBe(sb.match?.roomId);
    expect(sa.match?.mode).toBe('pvp');
    await A.joined.room.leave();
    await B.joined.room.leave();
    const j = await joinMatch(gs.url, a.api.token!, { roomId: sa.match!.roomId });
    const nm = new NetworkMatch(catalog, j.room, j.snapshot);
    expect((await gs.services.db.query<{ rematch_of: string }>('SELECT rematch_of FROM matches WHERE id = $1', [nm.matchId]))[0]!.rematch_of).toBe(A.nm.matchId);
    await j.room.leave();
  }, 60_000);
});

describe('Fase 7 — painel /admin e métricas', () => {
  it('painel exige o token; métricas e relatório refletem os dados oficiais e a pesquisa', async () => {
    expect((await fetch(`${gs.url}/admin`)).status).toBe(200); // a página não tem dados
    expect((await fetch(`${gs.url}/admin/api/metrics`)).status).toBe(401);
    expect((await fetch(`${gs.url}/admin/api/metrics`, { headers: { Authorization: 'Bearer errado' } })).status).toBe(401);
    const auth = { headers: { Authorization: `Bearer ${ADMIN}` } };
    const m = (await (await fetch(`${gs.url}/admin/api/metrics`, auth)).json()) as PlaytestMetrics;
    expect(m.matches.byMode.bot).toBeGreaterThanOrEqual(3);
    expect(m.matches.finished).toBeGreaterThanOrEqual(4);
    expect(m.rematch.rematched).toBeGreaterThanOrEqual(1);
    expect(m.rematch.rate).toBeGreaterThan(0);
    expect(m.abandonment.surrenders).toBeGreaterThanOrEqual(4);
    expect(m.survey.responses).toBe(1);
    expect(m.survey.fun.mean).toBe(4);
    expect(m.survey.botRating.find((x) => x.difficulty === 'easy')).toMatchObject({ n: 1, mean: 2 });
    expect(m.bugs.total).toBe(2);
    expect(m.bugs.withMatchReport).toBe(1);
    expect(m.classes.map((c) => c.classId).sort()).toEqual(Object.keys(catalog.classes).sort());
    expect(m.turns.human.n).toBeGreaterThan(0);
    expect(m.ui.totals.aimCancel).toBe(2);
    expect(m.decision.length).toBeGreaterThan(8);
    // Poucos dados: nenhum critério de go/no-go passa a valer.
    expect(m.decision.filter((d) => d.id === 'fun')[0]!.status).toBe('sem dados');
    const md = await (await fetch(`${gs.url}/admin/api/report.md`, auth)).text();
    for (const s of ['Duração média da partida', 'Tempo médio por turno', 'Classe mais utilizada', 'Taxa de vitória por classe', 'Habilidade mais utilizada', 'Habilidade menos utilizada', 'Explosões', 'Taxa de abandono', 'Taxa de revanche', 'Partidas contra bot', 'Retorno de jogadores']) expect(md).toContain(s);
    expect(md).toContain('Gostei do fogo no óleo');
    const html = await (await fetch(`${gs.url}/admin/api/report.html`, auth)).text();
    expect(html).toContain('<table>');
    const created = (await (await fetch(`${gs.url}/admin/api/invites`, { ...auth, method: 'POST', body: JSON.stringify({ count: 3, maxUses: 2, label: 'grupo 2' }) })).json()) as { codes: string[] };
    expect(created.codes).toHaveLength(3);
    await new GameApi(gs.url).register('via_painel', 'segredo123', undefined, created.codes[0]);
    const csv = await (await fetch(`${gs.url}/admin/api/surveys.csv`, auth)).text();
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('retorno D1/D7 a partir dos dias ativos (cadastro antigo + atividade depois)', async () => {
    const p = await newPlayer();
    await p.api.me();
    // Cadastro "há 8 dias", ativo no dia seguinte e no 7º dia.
    await gs.services.db.query("UPDATE accounts SET created_at = now() - interval '8 days' WHERE id = $1", [p.accountId]);
    await gs.services.db.query("UPDATE account_days SET day = day - 8 WHERE account_id = $1", [p.accountId]);
    await gs.services.db.query("INSERT INTO account_days (account_id, day) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - 7), ($1, (now() AT TIME ZONE 'UTC')::date - 1)", [p.accountId]);
    const m = await computePlaytestMetrics(gs.services.db, catalog);
    expect(m.retention.d1.eligible).toBeGreaterThanOrEqual(1);
    expect(m.retention.d1.returned).toBe(1);
    expect(m.retention.d7.returned).toBe(1);
    expect(renderMarkdown(m)).toContain('D1');
  });
});
