/**
 * Fase 7 — métricas do teste externo (seção 15, "Métricas principais"), calculadas a partir de:
 *
 * 1. **dados oficiais** do servidor (já gravados desde as Fases 3–5): partidas, assentos com o
 *    personagem, comandos aceitos (com horário), eventos oficiais, resultados e revanches;
 * 2. **telemetria do cliente** (opcional, com consentimento): sessões, telas, atritos de
 *    interface/câmera, tempo por turno medido no cliente, cliques em revanche, saídas;
 * 3. **pesquisa pós-partida** e **relatórios de bug** (voluntários).
 *
 * Tudo agregado; jogadores só aparecem pelo prefixo do `analytics_id`. Usado pelo painel
 * `/admin`, por `npm run metrics:report` e pela simulação do playtest.
 */
import type { Catalog } from '@bardurinho/domain';
import type { Queryable } from '../../db/database.js';

// ---------------------------------------------------------------------------
// Critérios de decisão (go/no-go para o beta) — os mesmos de docs/fase-07.md
// ---------------------------------------------------------------------------

export interface Threshold {
  id: string;
  label: string;
  /** Texto do alvo (como aparece no relatório). */
  target: string;
  /** Mínimo de amostras para o critério valer. */
  minSample: number;
  check: (m: PlaytestMetrics) => { value: number | null; sample: number; ok: boolean | null; shown: string };
}

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(0)} %`);
const fix = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d).replace('.', ','));

export const GO_NO_GO: Threshold[] = [
  {
    id: 'fun',
    label: 'Diversão média (pesquisa, 1–5)',
    target: '≥ 3,5',
    minSample: 10,
    check: (m) => ({ value: m.survey.fun.mean, sample: m.survey.responses, ok: m.survey.fun.mean === null ? null : m.survey.fun.mean >= 3.5, shown: fix(m.survey.fun.mean) }),
  },
  {
    id: 'play_again',
    label: '"Jogaria de novo" (sim + talvez)',
    target: '≥ 70 %',
    minSample: 10,
    check: (m) => {
      const r = m.survey.playAgain;
      const n = r.sim + r.talvez + r.nao;
      const v = n ? (r.sim + r.talvez) / n : null;
      return { value: v, sample: n, ok: v === null ? null : v >= 0.7, shown: pct(v) };
    },
  },
  {
    id: 'clarity',
    label: 'Clareza média (entendeu o que acontecia, 1–5)',
    target: '≥ 3,5',
    minSample: 10,
    check: (m) => ({ value: m.survey.clarity.mean, sample: m.survey.clarity.n, ok: m.survey.clarity.mean === null ? null : m.survey.clarity.mean >= 3.5, shown: fix(m.survey.clarity.mean) }),
  },
  {
    id: 'camera',
    label: 'Câmera média (ajudou, 1–5)',
    target: '≥ 3,5',
    minSample: 10,
    check: (m) => ({ value: m.survey.camera.mean, sample: m.survey.camera.n, ok: m.survey.camera.mean === null ? null : m.survey.camera.mean >= 3.5, shown: fix(m.survey.camera.mean) }),
  },
  {
    id: 'abandon',
    label: 'Taxa de abandono (partidas iniciadas)',
    target: '≤ 15 %',
    minSample: 20,
    check: (m) => ({ value: m.abandonment.rate, sample: m.abandonment.started, ok: m.abandonment.rate === null ? null : m.abandonment.rate <= 0.15, shown: pct(m.abandonment.rate) }),
  },
  {
    id: 'rematch',
    label: 'Taxa de revanche (partidas terminadas)',
    target: '≥ 20 %',
    minSample: 20,
    check: (m) => ({ value: m.rematch.rate, sample: m.rematch.eligible, ok: m.rematch.rate === null ? null : m.rematch.rate >= 0.2, shown: pct(m.rematch.rate) }),
  },
  {
    id: 'd1',
    label: 'Retorno D1',
    target: '≥ 30 %',
    minSample: 8,
    check: (m) => ({ value: m.retention.d1.rate, sample: m.retention.d1.eligible, ok: m.retention.d1.rate === null ? null : m.retention.d1.rate >= 0.3, shown: pct(m.retention.d1.rate) }),
  },
  {
    id: 'd7',
    label: 'Retorno D7',
    target: '≥ 15 %',
    minSample: 8,
    check: (m) => ({ value: m.retention.d7.rate, sample: m.retention.d7.eligible, ok: m.retention.d7.rate === null ? null : m.retention.d7.rate >= 0.15, shown: pct(m.retention.d7.rate) }),
  },
  {
    id: 'duration',
    label: 'Duração média da partida terminada',
    target: '5–20 min',
    minSample: 20,
    check: (m) => {
      const v = m.matches.duration.mean;
      return { value: v, sample: m.matches.duration.n, ok: v === null ? null : v >= 300 && v <= 1200, shown: dur(v) };
    },
  },
  {
    id: 'class_balance',
    label: 'Vitórias por classe (todos os participantes) dentro de 40–60 %',
    target: 'todas as classes com ≥ 20 jogos',
    minSample: 20,
    check: (m) => {
      const rows = m.classes.filter((c) => c.allGames >= 20);
      const n = Math.min(...m.classes.map((c) => c.allGames), Infinity);
      if (rows.length < m.classes.length || !rows.length) return { value: null, sample: Number.isFinite(n) ? n : 0, ok: null, shown: '—' };
      const out = rows.filter((c) => c.allWinRate! < 0.4 || c.allWinRate! > 0.6);
      return { value: out.length, sample: n, ok: out.length === 0, shown: out.length ? `fora: ${out.map((c) => `${c.name} ${pct(c.allWinRate)}`).join(', ')}` : 'todas dentro' };
    },
  },
  {
    id: 'bot_normal',
    label: 'Bot normal "na medida" (pesquisa, 1–5; 3 = na medida)',
    target: 'média 2,5–3,5',
    minSample: 5,
    check: (m) => {
      const b = m.survey.botRating.find((x) => x.difficulty === 'normal');
      const v = b?.mean ?? null;
      return { value: v, sample: b?.n ?? 0, ok: v === null ? null : v >= 2.5 && v <= 3.5, shown: fix(v) };
    },
  },
  {
    id: 'errors',
    label: 'Erros de cliente por sessão (telemetria)',
    target: '≤ 0,1',
    minSample: 20,
    check: (m) => {
      const v = m.sessions.count ? m.sessions.clientErrors / m.sessions.count : null;
      return { value: v, sample: m.sessions.count, ok: v === null ? null : v <= 0.1, shown: fix(v) };
    },
  },
];

// ---------------------------------------------------------------------------
// Tipos do resultado
// ---------------------------------------------------------------------------

export interface Stat {
  n: number;
  mean: number | null;
  median: number | null;
  p90: number | null;
}

export interface ClassRow {
  classId: string;
  name: string;
  humanPicks: number;
  humanShare: number | null;
  humanGames: number;
  humanWins: number;
  humanWinRate: number | null;
  allGames: number;
  allWins: number;
  allDraws: number;
  allWinRate: number | null;
  pvpGames: number;
  pvpWinRate: number | null;
}

export interface UsageRow {
  id: string;
  name: string;
  classId: string | null;
  uses: number;
  /** Partidas (de jogadores) em que a classe dona apareceu. */
  matchesWithClass: number;
  perMatch: number | null;
}

export interface PlaytestMetrics {
  generatedAt: string;
  window: { since: string | null; until: string | null };
  label: string | null;
  contentVersion: string;
  builds: Array<{ build: string; sessions: number }>;
  players: {
    total: number;
    withMatch: number;
    consented: number;
    declined: number;
    matchesPerPlayer: Stat;
    withThreeOrMore: number;
    inviteCodes: Array<{ code: string; players: number }>;
  };
  matches: {
    total: number;
    byMode: Record<string, number>;
    byStatus: Record<string, number>;
    started: number;
    finished: number;
    duration: Stat;
    rounds: Stat;
    byResult: Record<string, number>;
  };
  turns: {
    human: Stat;
    bot: Stat;
    humanTimerExpired: number;
    humanTurns: number;
    clientMeasured: Stat;
  };
  classes: ClassRow[];
  mostUsedClass: string | null;
  abilities: UsageRow[];
  mostUsedAbility: UsageRow | null;
  leastUsedAbility: UsageRow | null;
  weapons: UsageRow[];
  items: UsageRow[];
  actions: Record<string, number>;
  environment: {
    explosions: number;
    matchesWithExplosion: number;
    objectsDestroyed: Record<string, number>;
    ignitions: number;
    reactions: Record<string, number>;
    doorsAndInteractions: number;
    surfacesCreated: number;
    forcedMoves: number;
    totalInteractions: number;
    perMatch: number | null;
  };
  abandonment: {
    started: number;
    forfeitByAbandon: number;
    abortedAfterStart: number;
    surrenders: number;
    cancelledNoShow: number;
    rate: number | null;
    surrenderRate: number | null;
    clientLeaves: Record<string, number>;
  };
  rematch: {
    eligible: number;
    rematched: number;
    rate: number | null;
    byMode: Record<string, { eligible: number; rematched: number }>;
    clicks: number;
  };
  bots: Array<{ difficulty: string; matches: number; finished: number; humanWins: number; humanWinRate: number | null; duration: number | null; rounds: number | null }>;
  retention: {
    cohort: number;
    d1: { eligible: number; returned: number; rate: number | null };
    d7: { eligible: number; returned: number; rate: number | null };
    within7: { eligible: number; returned: number; rate: number | null };
    activeDays: Stat;
  };
  sessions: {
    count: number;
    clients: number;
    duration: Stat;
    screens: Record<string, number>;
    clientErrors: number;
    events: number;
  };
  ui: {
    matchesReported: number;
    perMatch: Record<string, number>;
    totals: Record<string, number>;
    rejectedByCode: Record<string, number>;
  };
  survey: {
    responses: number;
    shown: number;
    skipped: number;
    fun: Stat & { dist: number[] };
    clarity: Stat & { dist: number[] };
    camera: Stat & { dist: number[] };
    balance: Stat & { dist: Record<string, number> };
    botRating: Array<{ difficulty: string; n: number; mean: number | null; dist: number[] }>;
    playAgain: { sim: number; talvez: number; nao: number };
    funByClass: Array<{ classId: string; n: number; mean: number | null }>;
    funByMode: Array<{ mode: string; n: number; mean: number | null }>;
    comments: Array<{ at: string; mode: string | null; outcome: string | null; classId: string | null; fun: number | null; text: string }>;
  };
  bugs: { total: number; byCategory: Record<string, number>; withMatchReport: number; recent: Array<{ id: string; at: string; category: string; matchId: string | null; text: string; hasReport: boolean }> };
  decision: Array<{ id: string; label: string; target: string; shown: string; sample: number; minSample: number; status: 'ok' | 'atenção' | 'sem dados' }>;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface MetricsOptions {
  since?: Date | null;
  until?: Date | null;
  /** Texto de destaque no topo (ex.: "DADOS SIMULADOS"). */
  label?: string | null;
  now?: Date;
}

const toMs = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string).getTime());
const inc = (o: Record<string, number>, k: string, by = 1) => void (o[k] = (o[k] ?? 0) + by);

export function stat(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, median: null, p90: null };
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]!;
  return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, median: q(0.5), p90: q(0.9) };
}

const dayIndex = (ms: number) => Math.floor(ms / 86400_000);

export async function computePlaytestMetrics(db: Queryable, catalog: Catalog, opts: MetricsOptions = {}): Promise<PlaytestMetrics> {
  const now = opts.now ?? new Date();
  const since = opts.since ?? null;
  const until = opts.until ?? null;
  // Janela: $1 = início (ou -infinito), $2 = fim (ou +infinito).
  const win = [since ? since.toISOString() : '-infinity', until ? until.toISOString() : 'infinity'];
  const matchFilter = `m.mode <> 'custom' AND m.created_at >= $1::timestamptz AND m.created_at < $2::timestamptz`;

  // --- Jogadores -----------------------------------------------------------------------
  const players = await db.query<{ id: string; analytics_id: string; created_at: unknown; invite_code: string | null; telemetry_consent: boolean | null }>(
    `SELECT id, analytics_id, created_at, invite_code, telemetry_consent FROM accounts WHERE kind = 'player' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
    win,
  );
  const playerIds = new Set(players.map((p) => p.id));

  // --- Partidas ------------------------------------------------------------------------
  const matches = await db.query<{ id: string; mode: string; bot_difficulty: string | null; status: string; created_at: unknown; started_at: unknown; finished_at: unknown; rematch_of: string | null; result: { kind: string; winnerTeam?: string; reason?: string } | null; rounds: number | null }>(
    `SELECT m.id, m.mode, m.bot_difficulty, m.status, m.created_at, m.started_at, m.finished_at, m.rematch_of, m.result, r.rounds FROM matches m LEFT JOIN match_results r ON r.match_id = m.id WHERE ${matchFilter}`,
    win,
  );
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const seats = await db.query<{ match_id: string; seat: number; team: string; account_id: string; kind: string; class_id: string | null }>(
    `SELECT mp.match_id, mp.seat, mp.team, mp.account_id, a.kind, mp.character->>'classId' AS class_id
       FROM match_players mp JOIN accounts a ON a.id = mp.account_id JOIN matches m ON m.id = mp.match_id WHERE ${matchFilter}`,
    win,
  );
  const seatsOf = new Map<string, typeof seats>();
  for (const s of seats) {
    const list = seatsOf.get(s.match_id) ?? [];
    list.push(s);
    seatsOf.set(s.match_id, list);
  }
  const isHuman = (s: { kind: string }) => s.kind !== 'bot';

  const byMode: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byResult: Record<string, number> = {};
  const durations: number[] = [];
  const rounds: number[] = [];
  let started = 0;
  let finished = 0;
  for (const m of matches) {
    inc(byMode, m.mode);
    inc(byStatus, m.status);
    if (m.started_at) started++;
    if (m.status === 'finished') {
      finished++;
      const s = toMs(m.started_at);
      const f = toMs(m.finished_at);
      if (s !== null && f !== null && f >= s) durations.push((f - s) / 1000);
      if (m.rounds !== null) rounds.push(m.rounds);
      inc(byResult, m.result?.kind === 'victory' ? `vitória (${m.result.reason ?? '?'})` : `empate (${m.result?.reason ?? '?'})`);
    }
  }

  // Partidas por jogador (só contas de jogador).
  const matchesPerAccount = new Map<string, number>();
  for (const s of seats) if (playerIds.has(s.account_id)) matchesPerAccount.set(s.account_id, (matchesPerAccount.get(s.account_id) ?? 0) + 1);
  const inviteCodes: Record<string, number> = {};
  for (const p of players) inc(inviteCodes, p.invite_code ?? '(sem código)');

  // --- Comandos: turnos, habilidades, ações, abandono ---------------------------------------
  const commands = await db.query<{ match_id: string; seq: number; author_kind: string; seat: number | null; turn_id: number; type: string | null; ability_id: string | null; weapon_id: string | null; item_id: string | null; command_id: string; created_at: unknown }>(
    `SELECT c.match_id, c.seq, c.author_kind, c.seat, c.turn_id, c.payload->>'type' AS type, c.payload->>'abilityId' AS ability_id, c.payload->>'weaponId' AS weapon_id,
            c.payload->>'itemId' AS item_id, c.command_id, c.created_at
       FROM match_commands c JOIN matches m ON m.id = c.match_id WHERE c.accepted AND ${matchFilter} ORDER BY c.match_id, c.seq`,
    win,
  );
  const rejectedRows = await db.query<{ code: string | null; n: number }>(
    `SELECT c.error->>'code' AS code, count(*)::int AS n FROM match_commands c JOIN matches m ON m.id = c.match_id JOIN match_players mp ON mp.match_id = c.match_id AND mp.seat = c.seat JOIN accounts a ON a.id = mp.account_id
      WHERE NOT c.accepted AND a.kind <> 'bot' AND ${matchFilter} GROUP BY 1`,
    win,
  );
  const abilityUses: Record<string, number> = {};
  const weaponUses: Record<string, number> = {};
  const itemUses: Record<string, number> = {};
  const actions: Record<string, number> = {};
  const humanTurnSeconds: number[] = [];
  const botTurnSeconds: number[] = [];
  let humanTimerExpired = 0;
  let forfeitByAbandon = 0;
  let surrenders = 0;
  let interactions = 0;
  const byMatch = new Map<string, typeof commands>();
  for (const c of commands) {
    const list = byMatch.get(c.match_id) ?? [];
    list.push(c);
    byMatch.set(c.match_id, list);
  }
  for (const [matchId, list] of byMatch) {
    const seatKind = new Map((seatsOf.get(matchId) ?? []).map((s) => [s.seat, s.kind]));
    // Turnos: duração = fim do turno (último comando aceito dele) − fim do turno anterior.
    const turns = new Map<number, { end: number; seat: number | null; timer: boolean; any: boolean }>();
    let startAt: number | null = null;
    for (const c of list) {
      const at = toMs(c.created_at)!;
      if (c.type === 'START_MATCH') {
        startAt = at;
        continue;
      }
      const human = c.author_kind === 'player' && c.seat !== null && seatKind.get(c.seat) !== 'bot';
      if (c.author_kind === 'player' && c.seat !== null && human) {
        inc(actions, c.type ?? '?');
        if (c.type === 'USE_ABILITY' && c.ability_id) inc(abilityUses, c.ability_id);
        if (c.type === 'BASIC_ATTACK' && c.weapon_id) inc(weaponUses, c.weapon_id);
        if (c.type === 'USE_ITEM' && c.item_id) inc(itemUses, c.item_id);
        if (c.type === 'SURRENDER') surrenders++;
      }
      if (c.type === 'INTERACT') interactions++;
      if (c.command_id.startsWith('server:forfeit:')) forfeitByAbandon++;
      const t = turns.get(c.turn_id) ?? { end: at, seat: null, timer: false, any: false };
      t.end = Math.max(t.end, at);
      if (c.author_kind === 'player' && c.seat !== null) t.seat = c.seat;
      if (c.author_kind === 'timer') t.timer = true;
      t.any = true;
      turns.set(c.turn_id, t);
    }
    if (startAt === null) continue;
    const mode = matchById.get(matchId)?.mode;
    let prev = startAt;
    for (const id of [...turns.keys()].sort((a, b) => a - b)) {
      const t = turns.get(id)!;
      const seconds = (t.end - prev) / 1000;
      prev = t.end;
      // Turno só com o cronômetro: ninguém agiu. O bot nunca deixa esgotar → é de um jogador.
      const kind = t.seat !== null ? seatKind.get(t.seat) : mode === 'bot' || mode === 'pvp' || mode === 'private' ? 'player' : undefined;
      if (kind === undefined) continue;
      if (kind === 'bot') botTurnSeconds.push(seconds);
      else {
        humanTurnSeconds.push(seconds);
        if (t.timer && t.seat === null) humanTimerExpired++;
      }
    }
  }

  // --- Classes ---------------------------------------------------------------------------
  const classRows = new Map<string, ClassRow>();
  const classRow = (id: string) => {
    let r = classRows.get(id);
    if (!r) {
      r = { classId: id, name: catalog.classes[id]?.name ?? id, humanPicks: 0, humanShare: null, humanGames: 0, humanWins: 0, humanWinRate: null, allGames: 0, allWins: 0, allDraws: 0, allWinRate: null, pvpGames: 0, pvpWinRate: null };
      classRows.set(id, r);
    }
    return r;
  };
  for (const id of Object.keys(catalog.classes)) classRow(id);
  const pvpWins: Record<string, number> = {};
  const humanClassMatches: Record<string, Set<string>> = {};
  for (const s of seats) {
    if (!s.class_id) continue;
    const r = classRow(s.class_id);
    const m = matchById.get(s.match_id)!;
    if (isHuman(s)) {
      r.humanPicks++;
      (humanClassMatches[s.class_id] ??= new Set()).add(s.match_id);
    }
    if (m.status !== 'finished' || !m.result) continue;
    const win = m.result.kind === 'victory' && m.result.winnerTeam === s.team;
    const draw = m.result.kind !== 'victory';
    r.allGames++;
    if (win) r.allWins++;
    if (draw) r.allDraws++;
    if (isHuman(s)) {
      r.humanGames++;
      if (win) r.humanWins++;
    }
    if (m.mode === 'pvp' || m.mode === 'private') {
      r.pvpGames++;
      if (win) inc(pvpWins, s.class_id);
    }
  }
  const totalPicks = [...classRows.values()].reduce((a, r) => a + r.humanPicks, 0);
  for (const r of classRows.values()) {
    r.humanShare = totalPicks ? r.humanPicks / totalPicks : null;
    r.humanWinRate = r.humanGames ? r.humanWins / r.humanGames : null;
    r.allWinRate = r.allGames ? r.allWins / r.allGames : null;
    r.pvpWinRate = r.pvpGames ? (pvpWins[r.classId] ?? 0) / r.pvpGames : null;
  }
  const classes = [...classRows.values()].sort((a, b) => b.humanPicks - a.humanPicks || a.name.localeCompare(b.name));
  const mostUsedClass = classes[0]?.humanPicks ? classes[0].name : null;

  // --- Habilidades / armas / itens --------------------------------------------------------
  const ownerOf = (abilityId: string) => Object.values(catalog.classes).find((c) => c.loadout.abilities.includes(abilityId))?.id ?? null;
  const weaponOwner = (weaponId: string) => Object.values(catalog.classes).find((c) => c.loadout.weapons.includes(weaponId))?.id ?? null;
  const usage = (uses: Record<string, number>, ids: string[], owner: (id: string) => string | null, name: (id: string) => string): UsageRow[] =>
    ids
      .map((id) => {
        const cls = owner(id);
        const matchesWithClass = cls ? (humanClassMatches[cls]?.size ?? 0) : new Set(seats.filter(isHuman).map((s) => s.match_id)).size;
        return { id, name: name(id), classId: cls, uses: uses[id] ?? 0, matchesWithClass, perMatch: matchesWithClass ? (uses[id] ?? 0) / matchesWithClass : null };
      })
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const abilityIds = [...new Set([...Object.values(catalog.classes).flatMap((c) => c.loadout.abilities), ...Object.keys(abilityUses)])];
  const abilities = usage(abilityUses, abilityIds, ownerOf, (id) => catalog.abilities[id]?.name ?? id);
  const played = abilities.filter((a) => a.matchesWithClass > 0);
  const mostUsedAbility = played.length && played[0]!.uses > 0 ? played[0]! : null;
  const leastUsedAbility = played.length ? [...played].sort((a, b) => (a.perMatch ?? 0) - (b.perMatch ?? 0) || a.uses - b.uses)[0]! : null;
  const weapons = usage(weaponUses, [...new Set([...Object.values(catalog.classes).flatMap((c) => c.loadout.weapons), ...Object.keys(weaponUses)])], weaponOwner, (id) => catalog.items[id]?.name ?? id);
  const items = usage(itemUses, [...new Set([...Object.values(catalog.items).filter((i) => i.kind === 'consumable').map((i) => i.id), ...Object.keys(itemUses)])], () => null, (id) => catalog.items[id]?.name ?? id);

  // --- Ambiente ----------------------------------------------------------------------------
  const envRows = await db.query<{ type: string; detail: string | null; matches: number; n: number }>(
    `SELECT e.type, CASE WHEN e.type = 'OBJECT_DESTROYED' THEN e.event->'payload'->>'defId' WHEN e.type = 'REACTION_TRIGGERED' THEN e.event->'payload'->>'reaction' ELSE NULL END AS detail,
            count(DISTINCT e.match_id)::int AS matches, count(*)::int AS n
       FROM match_events e JOIN matches m ON m.id = e.match_id
      WHERE e.type IN ('EXPLOSION', 'OBJECT_DESTROYED', 'OBJECT_IGNITED', 'REACTION_TRIGGERED', 'SURFACE_CREATED', 'FORCED_MOVE') AND ${matchFilter}
      GROUP BY 1, 2`,
    win,
  );
  const objectsDestroyed: Record<string, number> = {};
  const reactions: Record<string, number> = {};
  let explosions = 0;
  let matchesWithExplosion = 0;
  let ignitions = 0;
  let surfacesCreated = 0;
  let forcedMoves = 0;
  for (const r of envRows) {
    if (r.type === 'EXPLOSION') {
      explosions += r.n;
      matchesWithExplosion += r.matches;
    } else if (r.type === 'OBJECT_DESTROYED') inc(objectsDestroyed, r.detail ?? '?', r.n);
    else if (r.type === 'REACTION_TRIGGERED') inc(reactions, r.detail ?? '?', r.n);
    else if (r.type === 'OBJECT_IGNITED') ignitions += r.n;
    else if (r.type === 'SURFACE_CREATED') surfacesCreated += r.n;
    else if (r.type === 'FORCED_MOVE') forcedMoves += r.n;
  }
  const destroyedTotal = Object.values(objectsDestroyed).reduce((a, b) => a + b, 0);
  const reactionsTotal = Object.values(reactions).reduce((a, b) => a + b, 0);
  const totalInteractions = interactions + destroyedTotal + reactionsTotal + ignitions;

  // --- Abandono ----------------------------------------------------------------------------
  const abortedAfterStart = matches.filter((m) => m.status === 'aborted' && m.started_at).length;
  const cancelledNoShow = matches.filter((m) => m.status === 'cancelled').length;

  // --- Revanche ----------------------------------------------------------------------------
  const rematchByMode: Record<string, { eligible: number; rematched: number }> = {};
  const rematchedIds = new Set(matches.filter((m) => m.rematch_of).map((m) => m.rematch_of!));
  let eligible = 0;
  let rematched = 0;
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const r = (rematchByMode[m.mode] ??= { eligible: 0, rematched: 0 });
    r.eligible++;
    eligible++;
    if (rematchedIds.has(m.id)) {
      r.rematched++;
      rematched++;
    }
  }

  // --- Bots ----------------------------------------------------------------------------------
  const bots = (['easy', 'normal', 'hard'] as const).map((difficulty) => {
    const list = matches.filter((m) => m.mode === 'bot' && m.bot_difficulty === difficulty);
    const fin = list.filter((m) => m.status === 'finished' && m.result);
    const wins = fin.filter((m) => {
      const human = (seatsOf.get(m.id) ?? []).find(isHuman);
      return human && m.result!.kind === 'victory' && m.result!.winnerTeam === human.team;
    }).length;
    const d = stat(fin.map((m) => ((toMs(m.finished_at) ?? 0) - (toMs(m.started_at) ?? 0)) / 1000).filter((x) => x >= 0));
    return { difficulty, matches: list.length, finished: fin.length, humanWins: wins, humanWinRate: fin.length ? wins / fin.length : null, duration: d.mean, rounds: stat(fin.map((m) => m.rounds ?? NaN)).mean };
  });

  // --- Retorno (D1/D7) -------------------------------------------------------------------------
  const days = await db.query<{ account_id: string; day: unknown }>(
    `SELECT account_id, day FROM account_days WHERE account_id IN (SELECT id FROM accounts WHERE kind = 'player' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz)
     UNION SELECT mp.account_id, (mp.joined_at AT TIME ZONE 'UTC')::date FROM match_players mp WHERE mp.account_id IN (SELECT id FROM accounts WHERE kind = 'player' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz)`,
    win,
  );
  const activeDays = new Map<string, Set<number>>();
  for (const d of days) {
    const set = activeDays.get(d.account_id) ?? new Set<number>();
    // `DATE` volta como Date à meia-noite UTC (PGlite/pg) ou texto AAAA-MM-DD.
    set.add(dayIndex(typeof d.day === 'string' ? Date.parse(`${d.day}T00:00:00Z`) : new Date(d.day as string).getTime()));
    activeDays.set(d.account_id, set);
  }
  const today = dayIndex(now.getTime());
  const ret = (offsets: number[], needDay: number) => {
    let el = 0;
    let back = 0;
    for (const p of players) {
      const d0 = dayIndex(toMs(p.created_at)!);
      if (d0 + needDay > today) continue;
      el++;
      const set = activeDays.get(p.id);
      if (set && offsets.some((o) => set.has(d0 + o))) back++;
    }
    return { eligible: el, returned: back, rate: el ? back / el : null };
  };

  // --- Telemetria do cliente ----------------------------------------------------------------------
  const evWin = `created_at >= $1::timestamptz AND created_at < $2::timestamptz`;
  const sessionsRows = await db.query<{ session_id: string; client_id: string; first: unknown; last: unknown; build: string | null }>(
    `SELECT session_id, min(client_id) AS client_id, min(created_at) AS first, max(created_at) AS last, max(build) AS build FROM analytics_events WHERE ${evWin} GROUP BY session_id`,
    win,
  );
  const builds: Record<string, number> = {};
  for (const s of sessionsRows) inc(builds, s.build ?? '?');
  const typeCounts = await db.query<{ type: string; screen: string | null; reason: string | null; n: number }>(
    `SELECT type, CASE WHEN type = 'screen_view' THEN props->>'screen' ELSE NULL END AS screen, CASE WHEN type = 'match_leave' THEN props->>'reason' ELSE NULL END AS reason, count(*)::int AS n
       FROM analytics_events WHERE ${evWin} GROUP BY 1, 2, 3`,
    win,
  );
  const screens: Record<string, number> = {};
  const clientLeaves: Record<string, number> = {};
  let clientErrors = 0;
  let events = 0;
  let rematchClicks = 0;
  let surveyShown = 0;
  let surveySkipped = 0;
  for (const r of typeCounts) {
    events += r.n;
    if (r.type === 'screen_view') inc(screens, r.screen ?? '?', r.n);
    if (r.type === 'match_leave') inc(clientLeaves, r.reason ?? '?', r.n);
    if (r.type === 'client_error') clientErrors += r.n;
    if (r.type === 'rematch_click') rematchClicks += r.n;
    if (r.type === 'survey_open') surveyShown += r.n;
    if (r.type === 'survey_skip') surveySkipped += r.n;
  }
  const uiRows = await db.query<{ props: Record<string, number | string | boolean> }>(`SELECT props FROM analytics_events WHERE type = 'match_ui' AND ${evWin}`, win);
  const uiTotals: Record<string, number> = {};
  const clientTurns: number[] = [];
  for (const r of uiRows) {
    for (const [k, v] of Object.entries(r.props ?? {})) if (typeof v === 'number' && k !== 'turnAvgS' && k !== 'turnMaxS') inc(uiTotals, k, v);
    const avg = r.props?.turnAvgS;
    const n = r.props?.turns;
    if (typeof avg === 'number' && typeof n === 'number') for (let i = 0; i < n; i++) clientTurns.push(avg);
  }
  const uiPerMatch: Record<string, number> = {};
  for (const [k, v] of Object.entries(uiTotals)) uiPerMatch[k] = uiRows.length ? v / uiRows.length : 0;
  const rejectedByCode: Record<string, number> = {};
  for (const r of rejectedRows) inc(rejectedByCode, r.code ?? '?', r.n);

  // --- Pesquisa ------------------------------------------------------------------------------------
  const surveys = await db.query<{ mode: string | null; bot_difficulty: string | null; outcome: string | null; class_id: string | null; fun: number | null; clarity: number | null; camera: number | null; balance: number | null; bot_rating: number | null; play_again: string | null; comment: string | null; created_at: unknown }>(
    `SELECT mode, bot_difficulty, outcome, class_id, fun, clarity, camera, balance, bot_rating, play_again, comment, created_at FROM feedback_surveys WHERE ${evWin} ORDER BY created_at DESC`,
    win,
  );
  const scale = (vals: Array<number | null>) => {
    const v = vals.filter((x): x is number => typeof x === 'number');
    const dist = [0, 0, 0, 0, 0];
    for (const x of v) if (x >= 1 && x <= 5) dist[x - 1]!++;
    return { ...stat(v), dist };
  };
  const balanceVals = surveys.map((s) => s.balance).filter((x): x is number => typeof x === 'number');
  const balanceDist: Record<string, number> = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
  for (const b of balanceVals) inc(balanceDist, String(b));
  const group = <K extends string>(key: (s: (typeof surveys)[number]) => K | null) => {
    const g = new Map<K, number[]>();
    for (const s of surveys) {
      const k = key(s);
      if (k === null || typeof s.fun !== 'number') continue;
      g.set(k, [...(g.get(k) ?? []), s.fun]);
    }
    return g;
  };
  const playAgain = { sim: 0, talvez: 0, nao: 0 };
  for (const s of surveys) if (s.play_again === 'sim' || s.play_again === 'talvez' || s.play_again === 'nao') playAgain[s.play_again]++;

  // --- Bugs -----------------------------------------------------------------------------------------
  const bugRows = await db.query<{ id: string; category: string; match_id: string | null; description: string; created_at: unknown; has_report: boolean }>(
    `SELECT id, category, match_id, description, created_at, report IS NOT NULL AS has_report FROM bug_reports WHERE ${evWin} ORDER BY created_at DESC`,
    win,
  );
  const bugCats: Record<string, number> = {};
  for (const b of bugRows) inc(bugCats, b.category);

  const metrics: PlaytestMetrics = {
    generatedAt: now.toISOString(),
    window: { since: since?.toISOString() ?? null, until: until?.toISOString() ?? null },
    label: opts.label ?? null,
    contentVersion: catalog.contentVersion,
    builds: Object.entries(builds).map(([build, sessions]) => ({ build, sessions })).sort((a, b) => b.sessions - a.sessions),
    players: {
      total: players.length,
      withMatch: [...matchesPerAccount.keys()].length,
      consented: players.filter((p) => p.telemetry_consent === true).length,
      declined: players.filter((p) => p.telemetry_consent === false).length,
      matchesPerPlayer: stat(players.map((p) => matchesPerAccount.get(p.id) ?? 0)),
      withThreeOrMore: players.filter((p) => (matchesPerAccount.get(p.id) ?? 0) >= 3).length,
      inviteCodes: Object.entries(inviteCodes).map(([code, n]) => ({ code, players: n })).sort((a, b) => b.players - a.players),
    },
    matches: { total: matches.length, byMode, byStatus, started, finished, duration: stat(durations), rounds: stat(rounds), byResult },
    turns: { human: stat(humanTurnSeconds), bot: stat(botTurnSeconds), humanTimerExpired, humanTurns: humanTurnSeconds.length, clientMeasured: stat(clientTurns) },
    classes,
    mostUsedClass,
    abilities,
    mostUsedAbility,
    leastUsedAbility,
    weapons,
    items,
    actions,
    environment: {
      explosions,
      matchesWithExplosion,
      objectsDestroyed,
      ignitions,
      reactions,
      doorsAndInteractions: interactions,
      surfacesCreated,
      forcedMoves,
      totalInteractions,
      perMatch: finished ? totalInteractions / finished : null,
    },
    abandonment: {
      started,
      forfeitByAbandon,
      abortedAfterStart,
      surrenders,
      cancelledNoShow,
      rate: started ? (forfeitByAbandon + abortedAfterStart) / started : null,
      surrenderRate: started ? surrenders / started : null,
      clientLeaves,
    },
    rematch: { eligible, rematched, rate: eligible ? rematched / eligible : null, byMode: rematchByMode, clicks: rematchClicks },
    bots,
    retention: {
      cohort: players.length,
      d1: ret([1], 1),
      d7: ret([7], 7),
      within7: ret([1, 2, 3, 4, 5, 6, 7], 7),
      activeDays: stat(players.map((p) => activeDays.get(p.id)?.size ?? 0)),
    },
    sessions: {
      count: sessionsRows.length,
      clients: new Set(sessionsRows.map((s) => s.client_id)).size,
      duration: stat(sessionsRows.map((s) => ((toMs(s.last) ?? 0) - (toMs(s.first) ?? 0)) / 1000)),
      screens,
      clientErrors,
      events,
    },
    ui: { matchesReported: uiRows.length, perMatch: uiPerMatch, totals: uiTotals, rejectedByCode },
    survey: {
      responses: surveys.length,
      shown: surveyShown,
      skipped: surveySkipped,
      fun: scale(surveys.map((s) => s.fun)),
      clarity: scale(surveys.map((s) => s.clarity)),
      camera: scale(surveys.map((s) => s.camera)),
      balance: { ...stat(balanceVals), dist: balanceDist },
      botRating: (['easy', 'normal', 'hard'] as const).map((difficulty) => {
        const sc = scale(surveys.filter((s) => s.mode === 'bot' && s.bot_difficulty === difficulty).map((s) => s.bot_rating));
        return { difficulty, n: sc.n, mean: sc.mean, dist: sc.dist };
      }),
      playAgain,
      funByClass: [...group((s) => s.class_id)].map(([classId, v]) => ({ classId, n: v.length, mean: stat(v).mean })).sort((a, b) => b.n - a.n),
      funByMode: [...group((s) => s.mode)].map(([mode, v]) => ({ mode, n: v.length, mean: stat(v).mean })).sort((a, b) => b.n - a.n),
      comments: surveys
        .filter((s) => s.comment && s.comment.trim())
        .slice(0, 60)
        .map((s) => ({ at: new Date(s.created_at as string).toISOString(), mode: s.mode, outcome: s.outcome, classId: s.class_id, fun: s.fun, text: s.comment!.trim() })),
    },
    bugs: {
      total: bugRows.length,
      byCategory: bugCats,
      withMatchReport: bugRows.filter((b) => b.has_report).length,
      recent: bugRows.slice(0, 40).map((b) => ({ id: b.id, at: new Date(b.created_at as string).toISOString(), category: b.category, matchId: b.match_id, text: b.description, hasReport: b.has_report })),
    },
    decision: [],
  };
  metrics.decision = GO_NO_GO.map((t) => {
    const r = t.check(metrics);
    const status = r.ok === null || r.sample < t.minSample ? 'sem dados' : r.ok ? 'ok' : 'atenção';
    return { id: t.id, label: t.label, target: t.target, shown: r.shown, sample: r.sample, minSample: t.minSample, status };
  });
  return metrics;
}

// ---------------------------------------------------------------------------
// Relatório (Markdown e HTML a partir da mesma estrutura)
// ---------------------------------------------------------------------------

export function dur(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${String(s).padStart(2, '0')} s`;
}
const n0 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));
const statLine = (s: Stat, f: (x: number | null) => string) => `${f(s.mean)} (mediana ${f(s.median)}, p90 ${f(s.p90)}, n = ${s.n})`;
const MODE: Record<string, string> = { bot: 'contra bot', pvp: 'online (fila)', private: 'convite', custom: 'personalizada' };
const DIFF: Record<string, string> = { easy: 'fácil', normal: 'normal', hard: 'difícil' };
const OUTCOME: Record<string, string> = { victory: 'vitória', defeat: 'derrota', draw: 'empate' };
const STATUS: Record<string, string> = { finished: 'terminada', aborted: 'abandonada (sala sem ninguém)', cancelled: 'cancelada (alguém não entrou)', active: 'em andamento', setup: 'montando' };

interface Section {
  title: string;
  lines?: string[];
  tables?: Array<{ caption?: string; headers: string[]; rows: Array<Array<string | number>> }>;
}

function sections(m: PlaytestMetrics): Section[] {
  const out: Section[] = [];
  const kv = (o: Record<string, number>, label: (k: string) => string = (k) => k) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${label(k)}: ${v}`)
      .join(' · ') || '—';
  out.push({
    title: 'Decisão: avançar para o beta? (critérios de go/no-go)',
    lines: [
      'Cada critério só vale com a amostra mínima; "sem dados" não conta a favor nem contra. A decisão final é humana: leia também os comentários e os bugs (docs/fase-07.md, "Modelo de decisão").',
    ],
    tables: [{ headers: ['Critério', 'Alvo', 'Valor', 'Amostra (mín.)', 'Situação'], rows: m.decision.map((d) => [d.label, d.target, d.shown, `${d.sample} (${d.minSample})`, d.status === 'ok' ? '✅ ok' : d.status === 'atenção' ? '⚠️ atenção' : '… sem dados']) }],
  });
  out.push({
    title: 'Métricas principais (plano, Fase 7)',
    tables: [
      {
        headers: ['Métrica', 'Valor'],
        rows: [
          ['Duração média da partida', `${dur(m.matches.duration.mean)} (mediana ${dur(m.matches.duration.median)}, p90 ${dur(m.matches.duration.p90)}, ${m.matches.duration.n} partidas terminadas)`],
          ['Tempo médio por turno (jogadores, servidor)', `${dur(m.turns.human.mean)} (mediana ${dur(m.turns.human.median)}, p90 ${dur(m.turns.human.p90)}, ${m.turns.human.n} turnos; ${m.turns.humanTimerExpired} esgotados pelo cronômetro)`],
          ['Tempo médio por turno (medido no cliente)', `${dur(m.turns.clientMeasured.mean)} (${m.turns.clientMeasured.n} turnos com telemetria)`],
          ['Classe mais utilizada (jogadores)', m.mostUsedClass ?? '—'],
          ['Taxa de vitória por classe', m.classes.map((c) => `${c.name} ${pct(c.allWinRate)} (${c.allGames})`).join(' · ')],
          ['Habilidade mais utilizada', m.mostUsedAbility ? `${m.mostUsedAbility.name} (${m.mostUsedAbility.uses} usos, ${n0(m.mostUsedAbility.perMatch)}/partida da classe)` : '—'],
          ['Habilidade menos utilizada', m.leastUsedAbility ? `${m.leastUsedAbility.name} (${m.leastUsedAbility.uses} usos, ${n0(m.leastUsedAbility.perMatch)}/partida da classe)` : '—'],
          ['Explosões', `${m.environment.explosions} (em ${m.environment.matchesWithExplosion} partidas)`],
          ['Interações ambientais', `${m.environment.totalInteractions} (${n0(m.environment.perMatch)} por partida terminada)`],
          ['Taxa de abandono', `${pct(m.abandonment.rate)} (${m.abandonment.forfeitByAbandon + m.abandonment.abortedAfterStart} de ${m.abandonment.started} iniciadas)`],
          ['Taxa de revanche', `${pct(m.rematch.rate)} (${m.rematch.rematched} de ${m.rematch.eligible} terminadas)`],
          ['Partidas contra bot', `${m.matches.byMode.bot ?? 0} (${m.bots.map((b) => `${DIFF[b.difficulty]} ${b.matches}`).join(' · ')})`],
          ['Retorno de jogadores', `D1 ${pct(m.retention.d1.rate)} (${m.retention.d1.returned}/${m.retention.d1.eligible}) · D7 ${pct(m.retention.d7.rate)} (${m.retention.d7.returned}/${m.retention.d7.eligible}) · em até 7 dias ${pct(m.retention.within7.rate)}`],
        ],
      },
    ],
  });
  out.push({
    title: 'Jogadores e partidas',
    lines: [
      `Jogadores cadastrados: **${m.players.total}** (${m.players.withMatch} jogaram ao menos uma partida; ${m.players.withThreeOrMore} jogaram 3 ou mais). Telemetria: ${m.players.consented} aceitaram, ${m.players.declined} recusaram.`,
      `Partidas por jogador: ${statLine(m.players.matchesPerPlayer, n0)}.`,
      `Partidas: **${m.matches.total}** — por modo: ${kv(m.matches.byMode, (k) => MODE[k] ?? k)}; por situação: ${kv(m.matches.byStatus, (k) => STATUS[k] ?? k)}.`,
      `Resultados: ${kv(m.matches.byResult)}. Rodadas por partida terminada: ${statLine(m.matches.rounds, n0)}.`,
      `Códigos de convite usados: ${m.players.inviteCodes.map((c) => `${c.code} (${c.players})`).join(' · ') || '—'}.`,
      `Turnos do bot (inclui a pausa de animação): ${statLine(m.turns.bot, dur)}.`,
    ],
  });
  out.push({
    title: 'Classes',
    tables: [
      {
        headers: ['Classe', 'Escolhas (jogadores)', '% das escolhas', 'Vitórias de jogadores', 'Taxa (jogadores)', 'Taxa (todos, inclui bots)', 'Jogos (todos)', 'Taxa PvP'],
        rows: m.classes.map((c) => [c.name, c.humanPicks, pct(c.humanShare), `${c.humanWins}/${c.humanGames}`, pct(c.humanWinRate), pct(c.allWinRate), c.allGames, c.pvpGames ? `${pct(c.pvpWinRate)} (${c.pvpGames})` : '—']),
      },
    ],
  });
  out.push({
    title: 'Habilidades, armas e itens (comandos aceitos de jogadores)',
    tables: [
      { caption: 'Habilidades', headers: ['Habilidade', 'Classe', 'Usos', 'Partidas com a classe', 'Usos por partida'], rows: m.abilities.map((a) => [a.name, a.classId ? (m.classes.find((c) => c.classId === a.classId)?.name ?? a.classId) : '—', a.uses, a.matchesWithClass, n0(a.perMatch)]) },
      { caption: 'Ataques básicos', headers: ['Arma', 'Usos', 'Usos por partida da classe'], rows: m.weapons.map((a) => [a.name, a.uses, n0(a.perMatch)]) },
      { caption: 'Consumíveis', headers: ['Item', 'Usos', 'Usos por partida'], rows: m.items.map((a) => [a.name, a.uses, n0(a.perMatch)]) },
      { caption: 'Comandos por tipo', headers: ['Tipo', 'Quantidade'], rows: Object.entries(m.actions).sort((a, b) => b[1] - a[1]) },
    ],
  });
  out.push({
    title: 'Interações ambientais',
    lines: [
      `Explosões: **${m.environment.explosions}** (partidas com explosão: ${m.environment.matchesWithExplosion}). Objetos incendiados: ${m.environment.ignitions}. Portas/interações (INTERACT): ${m.environment.doorsAndInteractions}.`,
      `Objetos destruídos: ${kv(m.environment.objectsDestroyed)}. Reações: ${kv(m.environment.reactions)}.`,
      `Superfícies criadas: ${m.environment.surfacesCreated}. Deslocamentos forçados: ${m.environment.forcedMoves}.`,
      'Interações ambientais (total) = INTERACT + objetos destruídos + reações + objetos incendiados. Contam as jogadas de todos os participantes (inclui os bots), a partir dos eventos oficiais.',
    ],
  });
  out.push({
    title: 'Abandono e revanche',
    lines: [
      `Iniciadas: ${m.abandonment.started}. Derrota por abandono (saiu e não voltou na reserva): ${m.abandonment.forfeitByAbandon}. Abandonadas pelos dois lados: ${m.abandonment.abortedAfterStart}. Desistências voluntárias: ${m.abandonment.surrenders} (${pct(m.abandonment.surrenderRate)}). Canceladas antes de começar (alguém não entrou): ${m.abandonment.cancelledNoShow}.`,
      `Saídas no meio da partida vistas pelo cliente: ${kv(m.abandonment.clientLeaves)}.`,
      `Revanche por modo: ${Object.entries(m.rematch.byMode).map(([k, v]) => `${MODE[k] ?? k} ${v.rematched}/${v.eligible}`).join(' · ') || '—'}. Cliques em "Revanche": ${m.rematch.clicks}.`,
    ],
  });
  out.push({
    title: 'Bots',
    tables: [
      {
        headers: ['Dificuldade', 'Partidas', 'Terminadas', 'Vitória dos jogadores', 'Duração média', 'Rodadas', 'Percepção (1 = muito fácil, 3 = na medida, 5 = muito difícil)'],
        rows: m.bots.map((b) => {
          const s = m.survey.botRating.find((x) => x.difficulty === b.difficulty);
          return [DIFF[b.difficulty] ?? b.difficulty, b.matches, b.finished, `${pct(b.humanWinRate)} (${b.humanWins})`, dur(b.duration), n0(b.rounds), s?.n ? `${fix(s.mean)} (n = ${s.n}; ${s.dist.join('/')})` : '—'];
        }),
      },
    ],
  });
  out.push({
    title: 'Retorno de jogadores',
    lines: [
      `Coorte: ${m.retention.cohort} jogadores. D1 = voltou no dia seguinte ao cadastro (UTC); D7 = voltou no 7º dia; "em até 7 dias" = qualquer dia de 1 a 7. Só entram os jogadores cujo dia já chegou.`,
      `D1: ${m.retention.d1.returned}/${m.retention.d1.eligible} (${pct(m.retention.d1.rate)}) · D7: ${m.retention.d7.returned}/${m.retention.d7.eligible} (${pct(m.retention.d7.rate)}) · em até 7 dias: ${m.retention.within7.returned}/${m.retention.within7.eligible} (${pct(m.retention.within7.rate)}). Dias ativos por jogador: ${statLine(m.retention.activeDays, n0)}.`,
    ],
  });
  const uiLabels: Record<string, string> = {
    aimCancel: 'mira cancelada',
    rejected: 'comando recusado pelo servidor',
    unavailable: 'ação indisponível clicada',
    cameraRotate: 'câmera: girar',
    cameraZoom: 'câmera: zoom',
    cameraPan: 'câmera: mover pelo teclado',
    cameraFocus: 'câmera: focar personagem',
    cameraDrag: 'câmera: arrastar com o mouse',
    floorChange: 'troca de andar',
    overview: 'visão geral',
    help: 'ajuda aberta',
    options: 'opções abertas',
    speed: 'velocidade alternada',
    turns: 'turnos jogados',
  };
  out.push({
    title: 'Interface e câmera (telemetria, por partida)',
    lines: [
      `Sessões: ${m.sessions.count} de ${m.sessions.clients} navegadores; duração ${statLine(m.sessions.duration, dur)}. Eventos: ${m.sessions.events}. Erros de cliente: ${m.sessions.clientErrors}.`,
      `Telas vistas: ${kv(m.sessions.screens)}.`,
      `Builds: ${m.builds.map((b) => `${b.build} (${b.sessions} sessões)`).join(' · ') || '—'}.`,
      `Recusas de comandos de jogadores por código (servidor): ${kv(m.ui.rejectedByCode)}.`,
    ],
    tables: [{ headers: ['Sinal', 'Média por partida', 'Total'], rows: Object.keys(m.ui.totals).sort().map((k) => [uiLabels[k] ?? k, n0(m.ui.perMatch[k] ?? 0), m.ui.totals[k]!]) }],
  });
  out.push({
    title: 'Pesquisa pós-partida',
    lines: [
      `Respostas: **${m.survey.responses}** (pesquisa aberta ${m.survey.shown} vezes; puladas ${m.survey.skipped}).`,
      `Diversão: ${statLine(m.survey.fun, (x) => fix(x))} — 1★…5★: ${m.survey.fun.dist.join(' / ')}.`,
      `Clareza: ${statLine(m.survey.clarity, (x) => fix(x))} — ${m.survey.clarity.dist.join(' / ')}.`,
      `Câmera: ${statLine(m.survey.camera, (x) => fix(x))} — ${m.survey.camera.dist.join(' / ')}.`,
      `Equilíbrio percebido (−2 muito contra mim … +2 muito a meu favor): média ${fix(m.survey.balance.mean)} — ${['-2', '-1', '0', '1', '2'].map((k) => `${k}: ${m.survey.balance.dist[k] ?? 0}`).join(' · ')}.`,
      `Jogaria de novo: sim ${m.survey.playAgain.sim} · talvez ${m.survey.playAgain.talvez} · não ${m.survey.playAgain.nao}.`,
      `Diversão por modo: ${m.survey.funByMode.map((x) => `${MODE[x.mode] ?? x.mode} ${fix(x.mean)} (${x.n})`).join(' · ') || '—'}. Por classe: ${m.survey.funByClass.map((x) => `${m.classes.find((c) => c.classId === x.classId)?.name ?? x.classId} ${fix(x.mean)} (${x.n})`).join(' · ') || '—'}.`,
    ],
    tables: m.survey.comments.length
      ? [{ caption: 'Comentários (mais recentes)', headers: ['Quando', 'Modo', 'Resultado', 'Classe', 'Diversão', 'Comentário'], rows: m.survey.comments.map((c) => [c.at.slice(0, 16).replace('T', ' '), MODE[c.mode ?? ''] ?? c.mode ?? '—', OUTCOME[c.outcome ?? ''] ?? c.outcome ?? '—', m.classes.find((x) => x.classId === c.classId)?.name ?? c.classId ?? '—', c.fun ?? '—', c.text]) }]
      : [],
  });
  out.push({
    title: 'Relatórios de bug',
    lines: [`Total: **${m.bugs.total}** (${m.bugs.withMatchReport} com o relatório da partida anexado) — por categoria: ${kv(m.bugs.byCategory)}. Reproduza com \`npm run regression:from-match\` a partir do JSON baixado no painel.`],
    tables: m.bugs.recent.length ? [{ headers: ['Quando', 'Categoria', 'Partida', 'Anexo', 'Descrição'], rows: m.bugs.recent.map((b) => [b.at.slice(0, 16).replace('T', ' '), b.category, b.matchId?.slice(0, 8) ?? '—', b.hasReport ? 'sim' : 'não', b.text]) }] : [],
  });
  return out;
}

const mdCell = (v: string | number) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderMarkdown(m: PlaytestMetrics): string {
  const head = [
    '# Relatório do teste externo (Fase 7)',
    '',
    ...(m.label ? [`> **${m.label}**`, ''] : []),
    `Gerado em ${m.generatedAt.slice(0, 19).replace('T', ' ')} UTC · janela ${m.window.since?.slice(0, 10) ?? 'início'} → ${m.window.until?.slice(0, 10) ?? 'agora'} · conteúdo ${m.contentVersion} · ${m.players.total} jogadores · ${m.matches.total} partidas`,
    '',
  ];
  const body = sections(m).flatMap((s) => [
    `## ${s.title}`,
    '',
    ...(s.lines ?? []).flatMap((l) => [l, '']),
    ...(s.tables ?? []).flatMap((t) => [
      ...(t.caption ? [`**${t.caption}**`, ''] : []),
      `| ${t.headers.map(mdCell).join(' | ')} |`,
      `|${t.headers.map(() => '---').join('|')}|`,
      ...t.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
      '',
    ]),
  ]);
  return [...head, ...body].join('\n');
}

const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Negrito do Markdown (**x**) e código (`x`) nas linhas, depois de escapar. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

/** Fragmento HTML do relatório (o painel /admin e o arquivo .html usam o mesmo). */
export function renderHtmlFragment(m: PlaytestMetrics): string {
  return [
    m.label ? `<div class="banner">${esc(m.label)}</div>` : '',
    `<p class="meta">Gerado em ${esc(m.generatedAt.slice(0, 19).replace('T', ' '))} UTC · janela ${esc(m.window.since?.slice(0, 10) ?? 'início')} → ${esc(m.window.until?.slice(0, 10) ?? 'agora')} · conteúdo ${esc(m.contentVersion)} · ${m.players.total} jogadores · ${m.matches.total} partidas</p>`,
    ...sections(m).map(
      (s) =>
        `<section><h2>${esc(s.title)}</h2>${(s.lines ?? []).map((l) => `<p>${inline(l)}</p>`).join('')}${(s.tables ?? [])
          .map((t) => `${t.caption ? `<h3>${esc(t.caption)}</h3>` : ''}<table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
          .join('')}</section>`,
    ),
  ].join('\n');
}

export const REPORT_CSS = `body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1180px;padding:0 16px;color:#1d1f23;background:#fafafa}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:14px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px;background:#fff}th,td{border:1px solid #e1e1e1;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f0f1f3;font-weight:600}td{font-variant-numeric:tabular-nums}.meta{color:#666}.banner{background:#fff3bf;border:1px solid #f0c000;padding:8px 12px;font-weight:700;margin:8px 0}
code{background:#eee;padding:0 3px;border-radius:3px}`;

export function renderHtml(m: PlaytestMetrics): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório do teste externo — Bardurinho RPG</title><style>${REPORT_CSS}</style></head><body><h1>Relatório do teste externo (Fase 7)</h1>${renderHtmlFragment(m)}</body></html>`;
}
