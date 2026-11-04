/**
 * Fase 6: uma partida bot × bot pelo core oficial, com verificação de invariantes a cada
 * comando aceito e estatísticas de uso (balanceamento). Usado por `npm run batch:invariants`,
 * `npm run balance` e pelo teste rápido `tests/unit/batch-smoke.test.ts`.
 */
import { computeTeamVision, isCellWalkable, projectStateForClient, type Catalog, type GameEvent, type GameState } from '@bardurinho/domain';
import { DEFAULT_CONSUMABLES, type CharacterChoice, type MapDefinition } from '@bardurinho/content';
import { runBotMatch, type BotDifficulty } from '@bardurinho/ai';
import { stateHash } from '@bardurinho/protocol';

export interface MatchSpec {
  seed: number;
  A: { difficulty: BotDifficulty; classes: string[] };
  B: { difficulty: BotDifficulty; classes: string[] };
  /** Verifica os invariantes (mais lento: projeção + visão a cada comando). */
  check?: boolean;
}

export interface ClassStats {
  damageDealt: number;
  damageTaken: number;
  healing: number;
  attacks: number;
  hits: number;
}

export interface MatchOutcome {
  seed: number;
  A: string[];
  B: string[];
  /** 'A' | 'B' | 'draw' | 'none' (sem resultado — violação). */
  winner: 'A' | 'B' | 'draw' | 'none';
  reason: string | null;
  rounds: number;
  commands: number;
  rejected: number;
  hash: string;
  ms: number;
  violations: string[];
  /** Uso por classe: chave do comando (ex.: `USE_ABILITY:mage.flame`, `BASIC_ATTACK:weapon.dagger`) → vezes. */
  usage: Record<string, Record<string, number>>;
  stats: Record<string, ClassStats>;
  env: Record<string, number>;
}

const choice = (classId: string): CharacterChoice => ({ classId, accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] });
const MAX_OF = { ap: 'maxAp', mp: 'maxMp', focus: 'maxFocus' } as const;

/** Invariantes do estado oficial (lista de problemas; vazia = ok). */
export function checkState(s: GameState, catalog: Catalog): string[] {
  const out: string[] = [];
  const occupied = new Map<string, string>();
  for (const u of Object.values(s.units)) {
    if (!Number.isFinite(u.hp)) out.push(`${u.id}: PV não finito (${u.hp})`);
    if (u.hp > u.maxHp) out.push(`${u.id}: PV ${u.hp} > máximo ${u.maxHp}`);
    if (u.alive && u.hp <= 0) out.push(`${u.id}: vivo com PV ${u.hp}`);
    if (!u.alive && u.hp > 0) out.push(`${u.id}: derrotado com PV ${u.hp}`);
    for (const [r, m] of Object.entries(MAX_OF) as Array<[keyof typeof MAX_OF, (typeof MAX_OF)[keyof typeof MAX_OF]]>) {
      const v = u[r];
      if (!Number.isInteger(v) || v < 0) out.push(`${u.id}: ${r} inválido (${v})`);
      if (v > u[m]) out.push(`${u.id}: ${r} ${v} > máximo ${u[m]}`);
    }
    if (u.shield && (u.shield.amount < 0 || !Number.isFinite(u.shield.amount))) out.push(`${u.id}: barreira inválida (${u.shield.amount})`);
    for (const [k, n] of Object.entries(u.usesThisTurn)) if (n < 0) out.push(`${u.id}: usos negativos de ${k}`);
    if (u.consumables.length > 2) out.push(`${u.id}: ${u.consumables.length} consumíveis`);
    if (!u.alive) continue;
    if (!isCellWalkable(s, catalog, u.pos)) out.push(`${u.id}: em célula não caminhável ${JSON.stringify(u.pos)}`);
    const k = `${u.pos.x},${u.pos.y},${u.pos.floor}`;
    if (occupied.has(k)) out.push(`${u.id} e ${occupied.get(k)} na mesma célula ${k}`);
    occupied.set(k, u.id);
  }
  for (const o of Object.values(s.objects)) {
    if (o.hp !== null && (o.hp < 0 || (o.maxHp !== null && o.hp > o.maxHp))) out.push(`${o.id}: PV de objeto inválido (${o.hp})`);
  }
  if (s.turn.round > s.maxRounds + 1) out.push(`rodada ${s.turn.round} além do limite ${s.maxRounds}`);
  if (s.status === 'active') {
    const a = s.turn.activeUnitId ? s.units[s.turn.activeUnitId] : undefined;
    if (!a || !a.alive) out.push(`personagem da vez inválido (${s.turn.activeUnitId})`);
  }
  if (s.status === 'finished' && !s.result) out.push('partida encerrada sem resultado');
  return out;
}

/** A projeção de cada equipe não pode ter inimigo vivo não detectado nem a semente dos dados. */
export function checkProjection(s: GameState, catalog: Catalog, team: string): string[] {
  const out: string[] = [];
  const view = projectStateForClient(s, catalog, team).state;
  if (view.rng.seed !== 0) out.push(`projeção ${team}: semente exposta`);
  if (s.status === 'finished') return out;
  const vision = computeTeamVision(s, catalog, team);
  for (const u of Object.values(view.units)) {
    if (u.team !== team && u.alive && !vision.visibleUnits.has(u.id)) out.push(`projeção ${team}: inimigo oculto ${u.id} enviado`);
  }
  for (const u of Object.values(s.units)) {
    if (u.team !== team && u.alive && vision.visibleUnits.has(u.id) && !view.units[u.id]) out.push(`projeção ${team}: inimigo visível ${u.id} faltando`);
  }
  return out;
}

const bump = (rec: Record<string, number>, k: string, n = 1) => {
  rec[k] = (rec[k] ?? 0) + n;
};

export function playMatch(spec: MatchSpec, catalog: Catalog, map: MapDefinition): MatchOutcome {
  const t0 = performance.now();
  const violations: string[] = [];
  const usage: MatchOutcome['usage'] = {};
  const stats: MatchOutcome['stats'] = {};
  const env: Record<string, number> = {};
  const classOf = (s: GameState, id: unknown) => (typeof id === 'string' ? (s.units[id]?.classId ?? null) : null);
  const st = (c: string) => (stats[c] ??= { damageDealt: 0, damageTaken: 0, healing: 0, attacks: 0, hits: 0 });
  // Barris: quem detonou cada barril (o dano da explosão conta para essa unidade).
  const owner = new Map<string, string>();
  const sourceUnit = (s: GameState, e: GameEvent): string | null => {
    const id = e.cause.sourceId;
    if (!id) return null;
    if (s.units[id]) return id;
    return owner.get(id) ?? null;
  };
  let report;
  try {
    report = runBotMatch({
      catalog,
      map,
      seed: spec.seed,
      A: { difficulty: spec.A.difficulty, characters: spec.A.classes.map(choice) },
      B: { difficulty: spec.B.difficulty, characters: spec.B.classes.map(choice) },
      onStep: ({ team, command, before, after, events }) => {
        const actor = 'actorId' in command ? before.units[command.actorId] : undefined;
        const cls = actor?.classId ?? team;
        const key =
          command.type === 'USE_ABILITY' ? `USE_ABILITY:${command.abilityId}`
          : command.type === 'BASIC_ATTACK' ? `BASIC_ATTACK:${command.weaponId}`
          : command.type === 'USE_ITEM' ? `USE_ITEM:${command.itemId}`
          : command.type === 'INTERACT' ? `INTERACT:${before.objects[command.objectId]?.defId ?? '?'}`
          : command.type;
        bump((usage[cls] ??= {}), key);
        for (const e of events) {
          const p = e.payload;
          switch (e.type) {
            case 'DAMAGE_APPLIED': {
              const amount = (Number(p.hpDamage) || 0) + (Number(p.shieldAbsorbed) || 0);
              const tc = classOf(after, p.targetId);
              if (tc) st(tc).damageTaken += amount;
              const src = sourceUnit(after, e);
              const sc = src ? classOf(after, src) : null;
              if (sc && src !== p.targetId) st(sc).damageDealt += amount;
              else if (tc) bump(env, 'dano em personagem sem autor inimigo', amount);
              break;
            }
            case 'HEALED': {
              const c = classOf(after, p.unitId);
              if (c) st(c).healing += Number(p.effective) || 0;
              break;
            }
            case 'ATTACK_ROLLED': {
              const c = classOf(after, p.attackerId);
              if (c) {
                st(c).attacks++;
                if (p.hit) st(c).hits++;
              }
              break;
            }
            case 'OBJECT_DESTROYED': {
              bump(env, `objeto destruído: ${String(p.defId)}`);
              if (p.defId === 'barrel') {
                const by = sourceUnit(after, e);
                if (by) owner.set(String(p.objectId), by);
              }
              break;
            }
            case 'EXPLOSION':
              bump(env, 'explosões');
              break;
            case 'SURFACE_CREATED':
              bump(env, `superfície criada: ${String(p.surface ?? p.kind)}`);
              break;
            case 'REACTION_TRIGGERED':
              bump(env, `reação: ${String(p.reactionId ?? p.reaction ?? p.kind ?? '?')}`);
              break;
          }
        }
        if (spec.check) {
          for (const v of checkState(after, catalog)) violations.push(`#${after.nextCommandSeq} ${command.type}: ${v}`);
          for (const t of ['A', 'B']) for (const v of checkProjection(after, catalog, t)) violations.push(`#${after.nextCommandSeq} ${command.type}: ${v}`);
          if (after.turn.round < before.turn.round) violations.push('rodada voltou');
        }
      },
    });
  } catch (err) {
    violations.push(`EXCEÇÃO: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return { seed: spec.seed, A: spec.A.classes, B: spec.B.classes, winner: 'none', reason: null, rounds: 0, commands: 0, rejected: 0, hash: '', ms: performance.now() - t0, violations, usage, stats, env };
  }
  const r = report.result;
  if (spec.check) {
    if (report.finalState.status !== 'finished' || !r) violations.push(`partida não terminou (status ${report.finalState.status}, rodada ${report.rounds}, ${report.commands} comandos)`);
    if (report.rounds > report.finalState.maxRounds) violations.push(`terminou na rodada ${report.rounds} > ${report.finalState.maxRounds}`);
  }
  const winner = !r ? 'none' : r.kind === 'draw' ? 'draw' : (r.winnerTeam as 'A' | 'B');
  return {
    seed: spec.seed,
    A: spec.A.classes,
    B: spec.B.classes,
    winner,
    reason: r ? r.reason : null,
    rounds: report.rounds,
    commands: report.commands,
    rejected: report.rejected,
    hash: stateHash(report.finalState),
    ms: performance.now() - t0,
    violations,
    usage,
    stats,
    env,
  };
}
