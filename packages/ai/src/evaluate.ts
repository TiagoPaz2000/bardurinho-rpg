/**
 * Avaliação de estados para o bot (seção 13). Tudo é leitura do estado (a visão da equipe do
 * bot) e das definições do catálogo; as consequências das ações vêm do próprio core
 * (`applyCommand` em simulação), nunca de regras copiadas aqui.
 */
import {
  attackHitChance,
  coordKey,
  diceStats,
  distance,
  getCell,
  hasLineOfSight,
  objectsAt,
  objectBlocksMovement,
  orthogonalNeighbors,
  reachableCells,
  sameCoord,
  type Catalog,
  type Coord,
  type EffectOp,
  type GameState,
  type Unit,
} from '@bardurinho/domain';

/** Pesos da avaliação (ajustáveis na Fase 6). */
export const WEIGHTS = {
  win: 100000,
  draw: -2000,
  ownHp: 1.0,
  ownAlive: 60,
  ownDead: -150,
  enemyHp: 1.3,
  enemyAlive: 60,
  enemyDead: 150,
  shield: 0.7,
  /** Foco: os primeiros pontos valem mais (habilidades custam 2–4). */
  focusLow: 1.0,
  focusHigh: 0.3,
  /** Consumíveis ainda na mão (não gastar à toa). */
  consumable: { 'consumable.health_potion': 9, 'consumable.focus_potion': 2, 'consumable.oil_flask': 5 } as Record<string, number>,
  /** PA/PM ainda não usados do personagem da vez (evita gastar em ações inúteis). */
  ap: 2.5,
  mp: 0.2,
  status: { burning: 8, slowed: 3, rooted: 4, hidden: 5 } as Record<string, number>,
  surfaceOwn: { fire: -10, thorns: -4, oil: -2 } as Record<string, number>,
  surfaceEnemy: { fire: 6, thorns: 2, oil: 3 } as Record<string, number>,
  /** Posição do personagem da vez (alcance, aproximação, exploração). */
  position: 1.0,
  /** Ameaça estimada dos inimigos no próximo turno (só o bot difícil). */
  threat: 0.8,
};

/** Alcance do ataque básico (armas): define se o personagem luta corpo a corpo ou à distância. */
export interface Reach {
  min: number;
  max: number;
  melee: boolean;
}

export function unitReach(unit: Unit, catalog: Catalog): Reach {
  let max = 1;
  let min = 1;
  let any = false;
  const consider = (r: { range?: number; minRange?: number }) => {
    const hi = r.range ?? 1;
    if (!any || hi > max) {
      max = hi;
      min = r.minRange ?? 0;
    }
    any = true;
  };
  for (const id of unit.weapons) {
    const w = catalog.items[id];
    if (w?.kind === 'weapon') consider(w.target);
  }
  return { min, max, melee: max <= 1 };
}

// ---------------------------------------------------------------------------
// Campo de deslocamento (Dijkstra a partir de um ou mais alvos)
// ---------------------------------------------------------------------------

export type Field = Map<string, number>;

/** Custo de entrar numa célula para o planejamento (portas/caixas custam mais; parede/barril bloqueiam). */
function planCost(state: GameState, catalog: Catalog, c: Coord): number {
  const cell = getCell(state.map, c);
  if (!cell || cell.terrain !== 'ground') return Infinity;
  let cost = 1;
  const surface = cell.surface?.kind;
  if (surface === 'fire') cost += 4;
  else if (surface === 'oil' || surface === 'thorns') cost += 1;
  for (const o of objectsAt(state, c)) {
    if (!objectBlocksMovement(catalog, o)) continue;
    if (o.defId === 'door') cost += 3;
    else if (o.hp !== null && o.defId !== 'barrel') cost += 6;
    else return Infinity;
  }
  return cost;
}

/**
 * Custo de viagem de cada célula até o alvo mais próximo (ignora personagens; portas fechadas
 * e caixas são atravessáveis com custo extra — o bot abre ou quebra no caminho).
 */
export function travelField(state: GameState, catalog: Catalog, targets: readonly Coord[]): Field {
  const dist: Field = new Map();
  const open: Array<{ c: Coord; d: number }> = [];
  for (const t of targets) {
    dist.set(coordKey(t), 0);
    open.push({ c: t, d: 0 });
  }
  const links = new Map<string, Array<{ to: Coord; cost: number }>>();
  for (const conn of state.map.connections) {
    const add = (a: Coord, b: Coord) => {
      const k = coordKey(a);
      if (!links.has(k)) links.set(k, []);
      links.get(k)!.push({ to: b, cost: conn.cost });
    };
    add(conn.a, conn.b);
    add(conn.b, conn.a);
  }
  const costCache = new Map<string, number>();
  const enter = (c: Coord) => {
    const k = coordKey(c);
    let v = costCache.get(k);
    if (v === undefined) costCache.set(k, (v = planCost(state, catalog, c)));
    return v;
  };
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.d < open[bi]!.d) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    const ck = coordKey(cur.c);
    if (cur.d > (dist.get(ck) ?? Infinity)) continue;
    // Aresta reversa: chegar em `cur` a partir de `n` custa entrar em `cur`.
    const curCost = cur.d === 0 ? 1 : enter(cur.c);
    if (!Number.isFinite(curCost)) continue;
    const next = [...orthogonalNeighbors(cur.c).map((to) => ({ to, cost: curCost })), ...(links.get(ck) ?? []).map((l) => ({ to: l.to, cost: l.cost }))];
    for (const n of next) {
      const cell = getCell(state.map, n.to);
      if (!cell || cell.terrain !== 'ground') continue;
      const nd = cur.d + n.cost;
      const nk = coordKey(n.to);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        open.push({ c: n.to, d: nd });
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export interface EvalContext {
  catalog: Catalog;
  team: string;
  /** Personagem da vez do bot (termos de posição e de PA/PM). */
  unitId: string;
  /** Campo de viagem até cada inimigo conhecido (por id) e até os alvos de exploração. */
  enemyFields: Map<string, Field>;
  exploreField: Field | null;
  reach: Reach;
}

const fieldAt = (f: Field | null | undefined, c: Coord) => (f ? (f.get(coordKey(c)) ?? 60) : 60);

/** Interesse da posição `at` para o personagem `me` (aproximar, ficar no alcance com visão, explorar). */
export function positionScore(state: GameState, ctx: EvalContext, me: Unit, at: Coord): number {
  const enemies = Object.values(state.units).filter((u) => u.alive && u.team !== ctx.team && !u.flags.isDummy);
  if (enemies.length === 0) return -1.2 * fieldAt(ctx.exploreField, at);
  let best = -Infinity;
  for (const e of enemies) {
    const travel = fieldAt(ctx.enemyFields.get(e.id), at);
    const d = distance(at, e.pos);
    let s: number;
    if (ctx.reach.melee) {
      s = -1.5 * travel + (d <= 1 && at.floor === e.pos.floor ? 10 : 0);
    } else {
      const inRange = d >= ctx.reach.min && d <= ctx.reach.max && hasLineOfSight(state, ctx.catalog, at, e.pos);
      s = inRange ? 10 - 0.4 * Math.abs(d - Math.max(2, ctx.reach.max - 1)) : -1.2 * Math.max(0, travel - ctx.reach.max) - 2;
      // Atirador colado num inimigo corpo a corpo fica exposto.
      if (d <= 1 && unitReach(e, ctx.catalog).melee) s -= 6;
    }
    best = Math.max(best, s);
  }
  return best;
}

const focusValue = (f: number) => Math.min(f, 4) * WEIGHTS.focusLow + Math.max(0, f - 4) * WEIGHTS.focusHigh;

const statusValue = (u: Unit) => u.statuses.reduce((s, x) => s + (WEIGHTS.status[x.statusId] ?? 0), 0);

/** Valor do estado do ponto de vista da equipe do bot (maior = melhor). */
export function evaluate(state: GameState, ctx: EvalContext): number {
  if (state.status === 'finished' && state.result) {
    const r = state.result;
    if (r.kind === 'draw') return WEIGHTS.draw;
    return r.winnerTeam === ctx.team ? WEIGHTS.win - state.turn.round : -WEIGHTS.win;
  }
  let v = 0;
  for (const u of Object.values(state.units)) {
    if (u.flags.isDummy) continue;
    const surface = getCell(state.map, u.pos)?.surface?.kind;
    if (u.team === ctx.team) {
      if (!u.alive) {
        v += WEIGHTS.ownDead;
        continue;
      }
      v += u.hp * WEIGHTS.ownHp + WEIGHTS.ownAlive + (u.shield?.amount ?? 0) * WEIGHTS.shield + focusValue(u.focus);
      for (const c of u.consumables) v += WEIGHTS.consumable[c] ?? 3;
      v -= u.statuses.reduce((s, x) => s + (x.statusId === 'hidden' ? -WEIGHTS.status.hidden! : (WEIGHTS.status[x.statusId] ?? 0)), 0);
      if (surface) v += WEIGHTS.surfaceOwn[surface] ?? 0;
      if (u.id === ctx.unitId) {
        v += u.ap * WEIGHTS.ap + u.mp * WEIGHTS.mp;
        v += WEIGHTS.position * positionScore(state, ctx, u, u.pos);
      }
    } else {
      if (!u.alive) {
        v += WEIGHTS.enemyDead;
        continue;
      }
      v -= u.hp * WEIGHTS.enemyHp + WEIGHTS.enemyAlive;
      v += statusValue(u) - (u.statuses.some((x) => x.statusId === 'hidden') ? 2 * WEIGHTS.status.hidden! : 0);
      if (surface) v += WEIGHTS.surfaceEnemy[surface] ?? 0;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Ameaça (resposta provável do adversário) — bot difícil
// ---------------------------------------------------------------------------

const damageOf = (effects: readonly EffectOp[]): number =>
  effects.reduce((s, e) => s + (e.op === 'damage' ? diceStats((e as { amount: string | number }).amount).average : 0), 0);

/**
 * Dano esperado que os inimigos conhecidos conseguem causar no próximo turno deles: para cada
 * inimigo, células alcançáveis com o PM máximo × armas/habilidades de dano (alcance, andar,
 * linha de visão) × chance de acerto. Considera dois ataques (2 PA), sem custo de Foco.
 */
export function threatAgainst(state: GameState, catalog: Catalog, team: string): number {
  const mine = Object.values(state.units).filter((u) => u.alive && u.team === team && !u.flags.isDummy);
  const enemies = Object.values(state.units).filter((u) => u.alive && u.team !== team && !u.flags.isDummy);
  let total = 0;
  for (const e of enemies) {
    const rooted = e.statuses.some((s) => s.statusId === 'rooted');
    const cells = rooted ? [e.pos] : [...reachableCells(state, catalog, e.pos, e.maxMp).values()].map((r) => r.coord);
    const options: Array<{ min: number; max: number; los: boolean; sameFloor: boolean; dmg: number; roll: boolean }> = [];
    for (const id of e.weapons) {
      const w = catalog.items[id];
      if (w?.kind === 'weapon') options.push({ min: w.target.minRange ?? 0, max: w.target.range ?? 1, los: !!w.target.requiresLineOfSight, sameFloor: !!w.target.sameFloor, dmg: diceStats(w.damage).average, roll: true });
    }
    for (const id of e.abilities) {
      const ab = catalog.abilities[id];
      if (!ab || ab.target.kind === 'self') continue;
      const dmg = damageOf(ab.effects);
      if (dmg > 0 && (ab.cost.focus ?? 0) <= e.focus) options.push({ min: ab.target.minRange ?? 0, max: ab.target.range ?? 1, los: !!ab.target.requiresLineOfSight, sameFloor: !!ab.target.sameFloor, dmg, roll: !!ab.attackRoll });
    }
    let best = 0;
    for (const t of mine) {
      for (const o of options) {
        const can = cells.some((c) => {
          const d = distance(c, t.pos);
          if (d < o.min || d > o.max) return false;
          if (o.sameFloor && c.floor !== t.pos.floor) return false;
          return !o.los || sameCoord(c, t.pos) || hasLineOfSight(state, catalog, c, t.pos);
        });
        if (!can) continue;
        const p = o.roll ? attackHitChance(e.attackBonus, t.defense) : 1;
        const dmg = Math.max(0, o.dmg - (t.armor ?? 0)) * p;
        best = Math.max(best, dmg);
      }
    }
    total += best * Math.min(2, e.maxAp);
  }
  return total;
}
