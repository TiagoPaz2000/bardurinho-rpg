/**
 * Fase 6: partida do servidor (`MatchSession`) sem rede — PGlite em memória, assentos
 * reservados, bots opcionais nos assentos — e um **auditor de informação oculta** que confere
 * cada mensagem enviada a cada equipe. Usado pelos testes de fuzz/ocultação.
 */
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import { catalog, patioDasRuinas, DEFAULT_CONSUMABLES, type CharacterChoice } from '@bardurinho/content';
import { computeTeamVision, type GameState } from '@bardurinho/domain';
import type { ServerMessages } from '@bardurinho/protocol';
import { openDatabase, type Database } from '../../../apps/server/src/db/database.js';
import { migrate } from '../../../apps/server/src/db/migrations.js';
import { AccountsRepository, MatchesRepository, type Account } from '../../../apps/server/src/db/repositories.js';
import { BotSeat } from '../../../apps/server/src/modules/bots/BotSeat.js';
import { MatchSession, type ReservedSeat } from '../../../apps/server/src/modules/matches/MatchSession.js';

export interface Harness {
  db: Database;
  accounts: AccountsRepository;
  matches: MatchesRepository;
  close(): Promise<void>;
}

export async function openHarness(): Promise<Harness> {
  const db = await openDatabase({ dataDir: 'memory' });
  await migrate(db);
  return { db, accounts: new AccountsRepository(db), matches: new MatchesRepository(db), close: () => db.close() };
}

export type Sent = { seat: number; type: keyof ServerMessages; msg: unknown; version: number };

/** Eventos públicos (estrutura do turno): podem citar qualquer id (ordem de iniciativa). */
const PUBLIC_EVENTS = new Set(['TURN_STARTED', 'TURN_ENDED', 'ROUND_STARTED', 'MATCH_STARTED', 'MATCH_ENDED', 'INITIATIVE_ROLLED']);

/**
 * Confere uma mensagem enviada à equipe `team`: nenhum id/classe de inimigo que a equipe não
 * conhecia (visível antes ou depois do comando, ou derrotado) fora da estrutura pública do turno;
 * semente dos dados e contador de eventos zerados. Devolve a lista de problemas.
 */
export function auditMessage(team: string, type: string, msg: unknown, before: GameState, after: GameState): string[] {
  const problems: string[] = [];
  const m = structuredClone(msg) as { state?: GameState; events?: Array<{ type: string }>; history?: Array<{ type: string }> };
  if (after.status === 'finished') return problems; // tudo é revelado no fim
  const vb = computeTeamVision(before, catalog, team);
  const va = computeTeamVision(after, catalog, team);
  const hidden = Object.values(after.units).filter((u) => u.team !== team && u.alive && !vb.visibleUnits.has(u.id) && !va.visibleUnits.has(u.id));
  if (m.state) {
    if (m.state.rng.seed !== 0 || m.state.rng.draws !== 0) problems.push(`${type}: semente/contador dos dados enviados`);
    if (m.state.nextEventSeq !== 0) problems.push(`${type}: nextEventSeq enviado`);
    for (const u of hidden) if (m.state.units[u.id]) problems.push(`${type}: inimigo oculto ${u.id} no estado`);
    // A ordem de iniciativa e a vez são públicas (só ids opacos).
    (m.state as Partial<GameState>).turn = undefined;
  }
  // Também sai o eco do próprio comando (o texto é do jogador: um id digitado por ele não é vazamento).
  const ownCommand = (e: { type: string; payload?: { command?: { actorId?: string } } }) => e.type === 'COMMAND_ACCEPTED' && after.units[e.payload?.command?.actorId ?? '']?.team === team;
  const strip = (list?: Array<{ type: string }>) => list?.filter((e) => !PUBLIC_EVENTS.has(e.type) && !ownCommand(e));
  if (m.events) m.events = strip(m.events);
  if (m.history) m.history = strip(m.history);
  const json = JSON.stringify(m);
  for (const u of hidden) {
    if (json.includes(`"${u.id}"`)) problems.push(`${type}: id do inimigo oculto ${u.id} na mensagem${process.env.AUDIT_DEBUG ? ` … ${json.slice(Math.max(0, json.indexOf(`"${u.id}"`) - 300), json.indexOf(`"${u.id}"`) + 100)}` : ""}`);
    const sameClassOnTeam = Object.values(after.units).some((x) => x.team === team && x.classId === u.classId);
    if (!sameClassOnTeam && u.classId && json.includes(`"classId":"${u.classId}"`)) problems.push(`${type}: classe do inimigo oculto (${u.classId})`);
  }
  if (type === 'update' && hidden.length && /"commandType":"(MOVE|USE_ABILITY|BASIC_ATTACK|USE_ITEM|DEFEND|INTERACT)"/.test(json)) {
    // Só é problema se o autor era desconhecido (o servidor troca por HIDDEN): confere abaixo pelo autor.
    const evs = (msg as { events: Array<{ type: string }> }).events;
    if (!evs.some((e) => e.type === 'COMMAND_ACCEPTED')) problems.push(`${type}: tipo do comando de um inimigo oculto`);
  }
  for (const u of Object.values(after.units)) if (!/^unit-[ab]\d$/.test(u.id)) problems.push(`id não opaco: ${u.id}`);
  return problems;
}

let accountSeq = 0;

export interface SessionRun {
  session: MatchSession;
  sent: Sent[];
  problems: string[];
  bots: BotSeat[];
  accounts: Account[];
  /** Estado oficial por versão (auditoria antes/depois). */
  states: Map<number, GameState>;
}

/**
 * Partida 1 × 1 com assentos reservados. `bots`: dificuldade por assento (ou `null` = humano,
 * dirigido pelo teste via `session.submit`). Toda mensagem enviada passa pelo auditor.
 */
export async function startSession(
  h: Harness,
  o: { seed: number; classes: [string, string]; bots?: [string | null, string | null]; turnSeconds?: number; botDelayMs?: number },
): Promise<SessionRun> {
  const accounts: Account[] = [];
  for (let i = 0; i < 2; i++) accounts.push(await h.accounts.ensure(`h${Date.now().toString(36)}${accountSeq++}`, `H${i}`, '', 'dev'));
  const bots = o.bots ?? [null, null];
  const reserved: ReservedSeat[] = [0, 1].map((seat) => {
    const choice: CharacterChoice = { classId: o.classes[seat]!, consumables: [...DEFAULT_CONSUMABLES], name: `P${seat}` };
    return { seat, account: accounts[seat]!, choice, character: { id: null, name: `P${seat}`, classId: choice.classId, appearance: { color: 'color.natural' } }, ...(bots[seat] ? { bot: bots[seat]! } : {}) };
  });
  const sent: Sent[] = [];
  const problems: string[] = [];
  const states = new Map<number, GameState>();
  const botSeats: BotSeat[] = [];
  // eslint-disable-next-line prefer-const
  let session: MatchSession;
  session = new MatchSession({
    roomId: `harness-${o.seed}`,
    mapId: patioDasRuinas.id,
    scenario: patioDasRuinas.scenario,
    teamSize: 1,
    setupMap: patioDasRuinas,
    reserved,
    mode: 'custom',
    catalog,
    repo: h.matches,
    seed: o.seed,
    turnSeconds: o.turnSeconds ?? 600,
    send: (seat, type, msg) => {
      const version = (msg as { version?: number }).version ?? session.version;
      if (!states.has(version)) states.set(version, session.state);
      const before = states.get(version - 1) ?? session.state;
      const team = session.seats[seat]!.team;
      for (const p of auditMessage(team, type, msg, type === 'snapshot' ? session.state : before, session.state)) problems.push(`v${version} → ${team}: ${p}`);
      sent.push({ seat, type, msg, version });
      for (const b of botSeats) if (b.seat === seat) b.notify();
    },
  });
  await session.ready;
  for (const [seat, diff] of bots.entries()) {
    if (!diff) continue;
    const team = session.seats[seat]!.team;
    const brain = new BotBrain(catalog, team, { difficulty: diff as 'easy' | 'normal' | 'hard', seed: o.seed + seat, explore: exploreTargets(patioDasRuinas, team) });
    botSeats.push(new BotSeat(session, seat, brain, { delayMs: o.botDelayMs ?? 0 }));
  }
  for (const [seat] of bots.entries()) if (!bots[seat]) await session.claimSeat(accounts[seat]!);
  for (const s of session.seats) s.connected = true;
  states.set(0, session.state);
  await session.start();
  for (const b of botSeats) b.notify();
  return { session, sent, problems, bots: botSeats, accounts, states };
}
