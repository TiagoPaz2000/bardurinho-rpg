/**
 * Fase 7 — simulação local de um teste externo (`npm run playtest:sim [-- --players 16]`).
 *
 * Valida, antes de existirem testadores reais, toda a cadeia do teste externo: servidor em
 * **configuração de produção** (sem /debug, cadastro só com convite, teste externo ligado,
 * cliente de produção servido na mesma porta), jogadores simulados com o mesmo código do
 * cliente (`GameApi` + `joinMatch` + `NetworkMatch`; decisões de um `BotBrain` só com a visão
 * da própria equipe), telemetria pelo endpoint real, pesquisas, bugs, revanches, abandonos,
 * desistências, PvP pela fila e retorno em dias diferentes (D1/D7) — e gera o relatório de
 * métricas (`docs/playtest-simulado.md`), marcado como DADOS SIMULADOS.
 *
 * Os "dias" são simulados: cada fase roda em segundos e, ao terminar, os horários gravados
 * nela são recuados no banco (dia 0 = 7 dias atrás, dia 1 = 6 dias atrás, dia 7 = hoje). O ritmo
 * de jogo também é simulado (decisões em ~0,05–0,3 s), então durações e tempos por turno são
 * muito menores que os reais — servem para conferir o cálculo, não o jogo.
 *
 * Opções: --players N (16), --seed S (7), --out arquivo-sem-extensão (docs/playtest-simulado).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BotBrain, exploreTargets, type BotDifficulty } from '@bardurinho/ai';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import type { PlaytestConfigDto, SurveyInput, TelemetryEvent } from '@bardurinho/protocol';
import { createGameServer } from '../../apps/server/src/app.js';
import { WEB_DIST } from '../../apps/server/src/config.js';
import { computePlaytestMetrics, dur, renderHtml, renderMarkdown } from '../../apps/server/src/modules/analytics/playtestMetrics.js';
import { GameApi } from '../../apps/web/src/network/api.js';
import { joinMatch } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';

const argv = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const PLAYERS = Math.max(4, Number(opt('players', '16')));
const SEED = Number(opt('seed', '7'));
const OUT = opt('out', 'docs/playtest-simulado');
const PORT = Number(process.env.SIM_PORT ?? 2591);
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sorteios reproduzíveis (mulberry32).
let rs = SEED >>> 0;
const rng = () => {
  rs = (rs + 0x6d2b79f5) >>> 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const weighted = <T>(xs: ReadonlyArray<[T, number]>): T => {
  let r = rng() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[xs.length - 1]![0];
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));
const poisson = (mean: number) => {
  let k = 0;
  let p = Math.exp(-mean);
  let s = p;
  const u = rng();
  while (u > s && k < 50) {
    k++;
    p *= mean / k;
    s += p;
  }
  return k;
};

// ---------------------------------------------------------------------------
// Servidor em configuração de produção
// ---------------------------------------------------------------------------
const hasDist = existsSync(`${WEB_DIST}index.html`);
const gs = await createGameServer({
  port: PORT,
  host: '127.0.0.1',
  dataDir: 'memory',
  log: false,
  dev: false,
  devAccounts: [],
  playtest: true,
  registration: 'invite',
  inviteCodes: [{ code: 'SIM-GRUPO', maxUses: 1000 }],
  adminToken: 'simulacao',
  staticDir: hasDist ? WEB_DIST : null,
  turnSeconds: 20,
  reconnectSeconds: 2,
  abandonSeconds: 30,
  joinTimeoutSeconds: 20,
  botDelayMs: 0,
  rateLimit: { loginFailuresPerUser: 0, loginPerIpPerMinute: 0, registerPerIpPer10Min: 0 },
});
const SERVER = gs.url;
const checks: string[] = [];
const check = (ok: boolean, what: string) => {
  checks.push(`${ok ? '✅' : '❌'} ${what}`);
  log(ok ? 'ok ' : 'FALHOU', what);
  if (!ok) process.exitCode = 1;
};
check((await fetch(`${SERVER}/debug/matches`)).status === 404, 'produção: /debug desligado (404)');
const cfg = (await (await fetch(`${SERVER}/playtest/config`)).json()) as PlaytestConfigDto;
check(cfg.playtest && cfg.registration === 'invite', `produção: teste externo ligado, cadastro só com convite (versão v${cfg.build.version} · ${cfg.build.commit})`);
if (hasDist) {
  const home = await fetch(`${SERVER}/`);
  const build = (await (await fetch(`${SERVER}/build.json`)).json()) as { version: string; commit: string };
  check(home.ok && (await home.text()).includes('renderCanvas'), `cliente de produção servido na mesma porta (build v${build.version} · ${build.commit})`);
} else log('aviso: apps/web/dist não existe (rode npm run build:web) — simulação sem o cliente estático');
check((await new GameApi(SERVER).register('sem_convite', 'segredo123').then(() => false, () => true)), 'cadastro sem código de convite recusado');

// ---------------------------------------------------------------------------
// Jogadores simulados
// ---------------------------------------------------------------------------
interface Persona {
  i: number;
  username: string;
  api: GameApi;
  classId: string;
  /** Qualidade das decisões do jogador simulado. */
  skill: BotDifficulty;
  /** Dificuldade de bot que costuma escolher. */
  botPref: 'easy' | 'normal' | 'hard';
  consent: boolean;
  clientId: string;
  funBase: number;
  /** Quanto se confunde com a interface (cancelamentos, recusas, ajuda). */
  confusion: number;
  cameraUse: number;
  pvp: number;
  rematch: number;
  abandon: number;
  surrender: number;
  survey: number;
  bug: number;
  returnD1: boolean;
  returnD7: boolean;
}

const COMMENTS = {
  good: [
    'Adorei acender o óleo e ver o barril explodir em cadeia.',
    'O mago com raio de gelo é muito divertido.',
    'Partida tensa até o fim, quero jogar de novo.',
    'Gostei de subir na plataforma e atirar de cima.',
    'O bot fácil é bom para aprender as regras.',
  ],
  meh: [
    'Demorei para entender o que era PM e PA.',
    'A câmera às vezes fica atrás da parede.',
    'Queria ver a área da habilidade antes de clicar.',
    'Não sabia de quem era a vez no começo.',
    'As partidas poderiam ser mais curtas.',
  ],
  bad: [
    'O bot difícil me venceu sem eu entender como.',
    'Perdi muito tempo procurando o inimigo pelo mapa.',
    'Achei o guerreiro forte demais.',
    'A câmera girou sozinha na explosão e me perdi.',
  ],
};
const BUGS = [
  ['camera', 'A câmera atravessou o muro quando girei perto da escada.'],
  ['interface', 'O botão da habilidade continuou aceso sem Foco suficiente.'],
  ['regras', 'O barril não explodiu quando acertei com fogo (ou explodiu tarde).'],
  ['conexao', 'Caiu a conexão por alguns segundos e voltou sozinho.'],
  ['desempenho', 'Ficou lento quando duas superfícies de fogo se juntaram.'],
] as const;

const personas: Persona[] = [];
for (let i = 0; i < PLAYERS; i++) {
  const api = new GameApi(SERVER);
  const username = `sim${String(i + 1).padStart(2, '0')}`;
  const engaged = rng();
  personas.push({
    i,
    username,
    api,
    classId: weighted([
      ['warrior', 3],
      ['mage', 3.5],
      ['rogue', 2],
      ['druid', 1.5],
    ]),
    skill: weighted<BotDifficulty>([
      ['easy', 3],
      ['normal', 4],
      ['hard', 2],
    ]),
    botPref: weighted([
      ['easy', 4],
      ['normal', 4],
      ['hard', 2],
    ]),
    consent: rng() < 0.85,
    clientId: `simcliente${i}${Math.floor(rng() * 1e6)}`,
    funBase: 2.6 + engaged * 2.2,
    confusion: 0.2 + rng() * 1.2,
    cameraUse: 0.5 + rng() * 2,
    pvp: rng() < 0.4 ? 0.6 : 0.1,
    rematch: 0.15 + engaged * 0.4,
    abandon: 0.04 + (1 - engaged) * 0.08,
    surrender: 0.03,
    survey: 0.55 + engaged * 0.4,
    bug: 0.06,
    returnD1: rng() < 0.25 + engaged * 0.4,
    returnD7: rng() < 0.12 + engaged * 0.35,
  });
}

// Retorno no 7º dia: parte de quem voltou no D1 e alguns que não voltaram (sempre ≥ 1, para a
// simulação exercitar o cálculo do D7).
personas.forEach((p, k) => {
  if (p.returnD1 && k % 2 === 0) p.returnD7 = true;
});
if (!personas.some((p) => p.returnD7)) personas[0]!.returnD7 = true;

/** Telemetria pelo endpoint real (só quem consentiu). */
async function track(p: Persona, session: string, events: Array<Omit<TelemetryEvent, 't'> & { t?: number }>) {
  if (!p.consent || !events.length) return;
  const body = { consent: true, clientId: p.clientId, sessionId: session, build: `v${cfg.build.version} · ${cfg.build.commit}`, events: events.map((e) => ({ t: Date.now(), ...e })) };
  const r = await fetch(`${SERVER}/telemetry/events`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${p.api.token}` }, body: JSON.stringify(body) });
  if (r.status !== 202) log(`telemetria recusada (${r.status}): ${await r.text()}`);
}

interface MatchOutcome {
  matchId: string;
  finished: boolean;
  outcome: 'victory' | 'defeat' | 'draw' | null;
  mode: 'bot' | 'pvp';
  difficulty: string | null;
  abandoned: boolean;
}

const stats = { matches: 0, abandoned: 0, surrendered: 0, rematches: 0, surveys: 0, bugs: 0, pvp: 0 };
/** Partidas distintas (no PvP os dois jogadores jogam a mesma). */
const seen = new Set<string>();

async function waitFor<T>(fn: () => T | Promise<T>, ms: number): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) return null;
    await sleep(20);
  }
}

/** Joga uma partida pelo cliente (visão da própria equipe), com abandono/desistência sorteados. */
async function playMatch(p: Persona, session: string, roomId: string): Promise<MatchOutcome> {
  const joined = await joinMatch(SERVER, p.api.token!, { roomId });
  const nm = new NetworkMatch(catalog, joined.room, joined.snapshot);
  if (!(await waitFor(() => nm.state.status !== 'setup', 30_000))) {
    // O adversário da fila não entrou: a partida foi cancelada pelo servidor.
    await joined.room.leave().catch(() => undefined);
    throw new Error('partida não começou (adversário não entrou)');
  }
  const botSeat = nm.seatList.find((s) => s.bot);
  const mode: 'bot' | 'pvp' = botSeat ? 'bot' : 'pvp';
  if (!seen.has(nm.matchId)) {
    seen.add(nm.matchId);
    stats.matches++;
    if (mode === 'pvp') stats.pvp++;
  }
  await track(p, session, [{ type: 'screen_view', props: { screen: 'match' } }, { type: 'match_start', matchId: nm.matchId, props: { mode, ...(botSeat?.bot ? { difficulty: botSeat.bot } : {}), resumed: false } }]);
  const brain = new BotBrain(catalog, nm.team, { difficulty: p.skill, seed: Math.floor(rng() * 1e9), explore: exploreTargets(patioDasRuinas, nm.team) });
  const abandonAt = rng() < p.abandon ? 2 + Math.floor(rng() * 6) : Infinity;
  const surrenderAt = abandonAt === Infinity && rng() < p.surrender ? 3 + Math.floor(rng() * 5) : Infinity;
  const turnTimes: number[] = [];
  let turnStart: number | null = null;
  let turnId = -1;
  let myTurns = 0;
  const started = Date.now();
  const finish = async (abandoned: boolean) => {
    const counts = {
      aimCancel: poisson(p.confusion * 0.35 * Math.max(1, myTurns)),
      unavailable: poisson(p.confusion * 0.25 * Math.max(1, myTurns)),
      cameraRotate: poisson(p.cameraUse * 0.6 * Math.max(1, myTurns)),
      cameraZoom: poisson(p.cameraUse * 0.8 * Math.max(1, myTurns)),
      cameraDrag: poisson(p.cameraUse * 0.5 * Math.max(1, myTurns)),
      cameraPan: poisson(p.cameraUse * 0.7 * Math.max(1, myTurns)),
      floorChange: poisson(0.15 * myTurns),
      overview: poisson(0.1 * myTurns),
      help: poisson(p.confusion * 0.4),
      options: poisson(0.2),
    };
    const avg = turnTimes.length ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length : 0;
    await track(p, session, [
      { type: 'match_ui', matchId: nm.matchId, props: { ...counts, turns: turnTimes.length, turnAvgS: Math.round(avg * 10) / 10, turnMaxS: turnTimes.length ? Math.round(Math.max(...turnTimes) * 10) / 10 : 0, partial: abandoned } },
      ...(abandoned ? [{ type: 'match_leave' as const, matchId: nm.matchId, props: { reason: rng() < 0.6 ? 'pagehide' : 'lobby_button' } }] : []),
    ]);
  };
  while (nm.state.status !== 'finished') {
    if (Date.now() - started > 240_000) {
      log(`  ${p.username}: partida longa demais — saindo`);
      await joined.room.leave();
      return { matchId: nm.matchId, finished: false, outcome: null, mode, difficulty: botSeat?.bot ?? null, abandoned: true };
    }
    const s = nm.state;
    const mine = s.status === 'active' && nm.canControl(s.turn.activeUnitId);
    if (s.turn.turnId !== turnId) {
      if (turnStart !== null) turnTimes.push((Date.now() - turnStart) / 1000);
      turnStart = null;
      turnId = s.turn.turnId;
      if (mine) {
        turnStart = Date.now();
        myTurns++;
      }
    }
    if (!mine || nm.busy) {
      await sleep(10);
      continue;
    }
    if (myTurns >= abandonAt) {
      stats.abandoned++;
      await finish(true);
      await joined.room.leave();
      return { matchId: nm.matchId, finished: false, outcome: null, mode, difficulty: botSeat?.bot ?? null, abandoned: true };
    }
    if (myTurns >= surrenderAt) {
      const u = Object.values(s.units).find((x) => x.alive && nm.canControl(x.id));
      if (u) {
        stats.surrendered++;
        await nm.execute({ type: 'SURRENDER', actorId: u.id });
        continue;
      }
    }
    // "Pensar": 50–300 ms por decisão (ritmo simulado).
    await sleep(50 + rng() * 250);
    if (nm.state.status !== 'active' || !nm.canControl(nm.state.turn.activeUnitId) || nm.state.turn.turnId !== turnId) continue;
    const d = brain.decide(nm.state);
    const r = await nm.execute(d.command);
    if (!r.ok) brain.rejectedCommand(d.command);
  }
  if (turnStart !== null) turnTimes.push((Date.now() - turnStart) / 1000);
  const res = nm.state.result!;
  const outcome = res.kind === 'victory' ? (res.winnerTeam === nm.team ? 'victory' : 'defeat') : 'draw';
  await finish(false);
  await track(p, session, [{ type: 'match_end', matchId: nm.matchId, props: { mode, outcome, rounds: nm.state.turn.round } }, { type: 'screen_view', props: { screen: 'result' } }]);
  await joined.room.leave();
  return { matchId: nm.matchId, finished: true, outcome, mode, difficulty: botSeat?.bot ?? null, abandoned: false };
}

/** Pesquisa (com notas coerentes com a persona e o resultado) e, às vezes, um bug. */
async function afterMatch(p: Persona, session: string, m: MatchOutcome) {
  if (!m.finished) return;
  await track(p, session, [{ type: 'survey_open', matchId: m.matchId }]);
  if (rng() < p.survey) {
    const swing = m.outcome === 'victory' ? 0.5 : m.outcome === 'defeat' ? -0.4 : 0;
    const fun = clamp(p.funBase + swing + (rng() - 0.5) * 1.2, 1, 5);
    const diffIdx = { easy: 0, normal: 1, hard: 2 }[m.difficulty as 'easy'] ?? 1;
    const input: SurveyInput = {
      matchId: m.matchId,
      fun,
      clarity: clamp(4.3 - p.confusion * 1.2 + (rng() - 0.5), 1, 5),
      camera: clamp(4.1 - p.confusion * 0.6 + (rng() - 0.5) * 1.4, 1, 5),
      balance: clamp((m.outcome === 'victory' ? 0.6 : m.outcome === 'defeat' ? -0.8 : 0) + (rng() - 0.5) * 1.5, -2, 2),
      botRating: m.mode === 'bot' ? clamp(1.8 + diffIdx * 1.1 + (m.outcome === 'defeat' ? 0.6 : m.outcome === 'victory' ? -0.4 : 0) + (rng() - 0.5), 1, 5) : null,
      playAgain: fun >= 4 ? 'sim' : fun === 3 ? pick(['sim', 'talvez', 'talvez'] as const) : pick(['talvez', 'nao'] as const),
      comment: rng() < 0.45 ? `[simulado] ${pick(fun >= 4 ? COMMENTS.good : fun === 3 ? COMMENTS.meh : COMMENTS.bad)}` : '',
      build: `v${cfg.build.version} · ${cfg.build.commit}`,
    };
    await p.api.submitSurvey(input);
    stats.surveys++;
    await track(p, session, [{ type: 'survey_submit', matchId: m.matchId }]);
  } else await track(p, session, [{ type: 'survey_skip', matchId: m.matchId }]);
  if (rng() < p.bug) {
    const [category, text] = pick(BUGS);
    await track(p, session, [{ type: 'bug_report_open', matchId: m.matchId }]);
    await p.api.reportBug({ matchId: m.matchId, category, description: `[simulado] ${text}`, client: { w: 1920, h: 1080 } });
    stats.bugs++;
    await track(p, session, [{ type: 'bug_report_submit', matchId: m.matchId }]);
  }
}

/** Uma partida a partir do lobby: PvP pela fila (até 5 s esperando) ou contra o bot. */
async function startMatch(p: Persona): Promise<string> {
  if (rng() < p.pvp) {
    await p.api.joinQueue();
    const st = await waitFor(async () => (await p.api.lobbyStatus()).match, 5000);
    if (st) return st.roomId;
    await p.api.leaveQueue();
    const late = (await p.api.lobbyStatus()).match;
    if (late) return late.roomId;
  }
  const diff = rng() < 0.7 ? p.botPref : pick(['easy', 'normal', 'hard'] as const);
  return (await p.api.playBot(diff)).roomId;
}

/** Revanche: bot → na hora; PvP → pede e espera até 4 s pelo outro. */
async function tryRematch(p: Persona, session: string, m: MatchOutcome): Promise<string | null> {
  if (!m.finished || rng() >= p.rematch) return null;
  await track(p, session, [{ type: 'rematch_click', matchId: m.matchId, props: { mode: m.mode } }]);
  try {
    const r = await p.api.rematch(m.matchId);
    if (r.status === 'created') return r.roomId;
    const st = await waitFor(async () => (await p.api.lobbyStatus()).match, 4000);
    if (st) return st.roomId;
    await p.api.cancelInvite(r.inviteId).catch(() => undefined);
  } catch {
    /* o adversário já começou outra coisa */
  }
  return null;
}

/** Uma "sessão" de jogo de um dia: abre o jogo, joga algumas partidas, sai. */
async function daySession(p: Persona, day: number, matchesWanted: number) {
  const session = `simsessao${p.i}d${day}${Math.floor(rng() * 1e6)}`;
  if (day === 0) {
    await p.api.register(p.username, 'senha-simulada', `Testador ${p.i + 1}`, 'sim-grupo');
    await p.api.setConsent(p.consent);
    await track(p, session, [{ type: 'session_start', props: { w: 1920, h: 1080, dpr: 1, touch: false } }, { type: 'consent', props: { value: true } }, { type: 'screen_view', props: { screen: 'login' } }, { type: 'screen_view', props: { screen: 'character' } }]);
    await p.api.createCharacter({ name: `Herói ${p.i + 1}`, classId: p.classId, accessoryId: pick([null, 'accessory.vitality_amulet', 'accessory.ash_medallion', 'accessory.frost_medallion']) });
  } else {
    await track(p, session, [{ type: 'session_start', props: { w: 1920, h: 1080, dpr: 1, touch: false } }]);
  }
  await p.api.me();
  // Às vezes troca de classe num personagem novo (até 3 por conta).
  if (day > 0 && rng() < 0.3) {
    const me = await p.api.me();
    if (me.characters.length < 3) await p.api.createCharacter({ name: `Outro ${p.i + 1}${day}`, classId: pick(Object.keys(catalog.classes)) }).catch(() => undefined);
  }
  let played = 0;
  let next: string | null = null;
  while (played < matchesWanted) {
    await track(p, session, [{ type: 'screen_view', props: { screen: 'lobby' } }, { type: 'heartbeat' }]);
    const roomId = next ?? (await startMatch(p));
    if (next) stats.rematches++;
    next = null;
    const m = await playMatch(p, session, roomId).catch((err: unknown) => {
      log(`  ${p.username}: falha na partida (${String(err)})`);
      return null;
    });
    played++;
    if (!m) continue;
    if (m.abandoned) break; // quem abandona fecha o jogo
    await afterMatch(p, session, m);
    next = await tryRematch(p, session, m);
    if (next && played >= matchesWanted) played--; // a revanche aceita é jogada
  }
  await track(p, session, [{ type: 'page_hide' }]);
}

/** Recuar no banco os horários gravados desde `since` (o "dia" simulado). */
async function shiftSince(since: Date, days: number) {
  if (!days) return;
  const db = gs.services.db;
  const cols: Array<[string, string]> = [
    ['accounts', 'created_at'],
    ['accounts', 'telemetry_consent_at'],
    ['sessions', 'created_at'],
    ['characters', 'created_at'],
    ['characters', 'updated_at'],
    ['inventory', 'acquired_at'],
    ['coin_ledger', 'created_at'],
    ['purchases', 'created_at'],
    ['mission_progress', 'completed_at'],
    ['matches', 'created_at'],
    ['matches', 'started_at'],
    ['matches', 'finished_at'],
    ['match_players', 'joined_at'],
    ['match_commands', 'created_at'],
    ['match_snapshots', 'created_at'],
    ['match_results', 'finished_at'],
    ['match_rewards', 'created_at'],
    ['analytics_events', 'client_ts'],
    ['analytics_events', 'created_at'],
    ['feedback_surveys', 'created_at'],
    ['bug_reports', 'created_at'],
  ];
  const iso = since.toISOString();
  for (const [t, c] of cols) await db.query(`UPDATE ${t} SET ${c} = ${c} - interval '${days} days' WHERE ${c} >= $1::timestamptz`, [iso]);
  await db.query(`UPDATE account_days SET day = day - ${days}, first_at = first_at - interval '${days} days' WHERE first_at >= $1::timestamptz`, [iso]);
}

const PHASES: Array<{ day: number; who: (p: Persona) => boolean; matches: () => number }> = [
  { day: 0, who: () => true, matches: () => 2 + Math.floor(rng() * 3) },
  { day: 1, who: (p) => p.returnD1, matches: () => 1 + Math.floor(rng() * 3) },
  { day: 3, who: (p) => p.returnD1 && rng() < 0.4, matches: () => 1 + Math.floor(rng() * 2) },
  { day: 7, who: (p) => p.returnD7, matches: () => 1 + Math.floor(rng() * 2) },
];
const TODAY = 7;
try {
  for (const ph of PHASES) {
    const group = personas.filter(ph.who);
    const since = new Date();
    log(`== dia ${ph.day}: ${group.length} jogador(es)`);
    // Entradas escalonadas (o PvP pela fila precisa de gente ao mesmo tempo).
    await Promise.all(
      group.map(async (p, k) => {
        await sleep(k * 150);
        await daySession(p, ph.day, ph.matches());
      }),
    );
    await sleep(2500); // abandonos pendentes (reserva de 2 s) viram derrota
    await shiftSince(since, TODAY - ph.day);
    log(`   dia ${ph.day} concluído (${stats.matches} partidas até agora)`);
  }
  const m = await computePlaytestMetrics(gs.services.db, catalog, {
    label: `DADOS SIMULADOS — ${PLAYERS} jogadores simulados (npm run playtest:sim, semente ${SEED}); ritmo de jogo acelerado (durações e tempos por turno não são reais). Não usar para decidir o beta.`,
  });
  const md = renderMarkdown(m);
  mkdirSync('tests/output/playtest-sim', { recursive: true });
  writeFileSync('tests/output/playtest-sim/relatorio.html', renderHtml(m));
  writeFileSync('tests/output/playtest-sim/metricas.json', JSON.stringify(m, null, 2));
  const intro = [
    '<!-- Gerado por `npm run playtest:sim` — não editar à mão. -->',
    '',
    '> ⚠️ **DADOS SIMULADOS.** Este relatório vem de uma simulação local do teste externo (Fase 7): jogadores robôs com o mesmo código do cliente, dias simulados e ritmo acelerado. Ele serve para validar a coleta e o cálculo das métricas — **não** diz nada sobre se o jogo é divertido. O critério de aprovação da Fase 7 continua pendente até o teste com pessoas reais (docs/fase-07.md).',
    '',
    `Conferências da simulação: ${checks.join(' · ')}.`,
    '',
    `Resumo da execução: ${stats.matches} partidas jogadas (${stats.pvp} PvP), ${stats.abandoned} abandonos, ${stats.surrendered} desistências, ${stats.rematches} revanches jogadas, ${stats.surveys} pesquisas, ${stats.bugs} bugs; ${((Date.now() - t0) / 1000).toFixed(0)} s. Duração média calculada: ${dur(m.matches.duration.mean)}.`,
    '',
  ].join('\n');
  writeFileSync(`${OUT}.md`, `${intro}\n${md}`);
  // Conferências do relatório contra o que a simulação fez.
  check(m.players.total === PLAYERS, `relatório: ${m.players.total} jogadores = ${PLAYERS} simulados`);
  check(m.matches.total >= stats.matches, `relatório: ${m.matches.total} partidas (≥ ${stats.matches} jogadas)`);
  check(m.survey.responses === stats.surveys, `relatório: ${m.survey.responses} pesquisas = ${stats.surveys} enviadas`);
  check(m.bugs.total === stats.bugs && m.bugs.withMatchReport === stats.bugs, `relatório: ${m.bugs.total} bugs, todos com o registro da partida`);
  check(m.rematch.rematched >= 1 && m.rematch.rate !== null, `relatório: taxa de revanche ${(100 * (m.rematch.rate ?? 0)).toFixed(0)} %`);
  check(m.abandonment.forfeitByAbandon + m.abandonment.abortedAfterStart >= Math.min(1, stats.abandoned), `relatório: ${m.abandonment.forfeitByAbandon} derrotas por abandono (${stats.abandoned} abandonos simulados)`);
  check(m.retention.d1.eligible === PLAYERS && m.retention.d1.returned > 0 && m.retention.d7.returned > 0, `relatório: retorno D1 ${m.retention.d1.returned}/${m.retention.d1.eligible}, D7 ${m.retention.d7.returned}/${m.retention.d7.eligible}`);
  check(m.sessions.count > 0 && m.ui.matchesReported > 0, `relatório: ${m.sessions.count} sessões e ${m.ui.matchesReported} resumos de interface pela telemetria`);
  check(m.matches.duration.n > 0 && m.turns.human.n > 0, 'relatório: duração e tempo por turno calculados');
  log(`relatório: ${OUT}.md (+ tests/output/playtest-sim/relatorio.html)`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await gs.close();
}
log(`simulação ${process.exitCode ? 'FALHOU' : 'OK'} em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(process.exitCode ?? 0);
