/**
 * Lista de ações disponíveis e indisponíveis (com motivo) para um personagem, ou
 * de um personagem sobre um alvo. Usa as mesmas pré-condições do processador
 * (`checks.ts`) e, para alvos, sonda o próprio `applyCommand` — nenhuma regra é duplicada.
 * Serve à interface (Debug Lab, cliente 3D) e, futuramente, ao bot.
 */
import { crossArea, distance } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import { allCoords, getCell } from '../map/grid.js';
import { reachableCells } from '../map/pathfinding.js';
import type { Catalog, Cost, EffectOp, TargetingRule } from '../rules/definitions.js';
import { entitiesAt, unitAt } from '../state/queries.js';
import type { GameState, Unit } from '../state/types.js';
import { applyCommand } from './engine.js';
import {
  DEFEND_SHIELD,
  INTERACT_COST,
  checkAbility,
  checkActor,
  checkCanMove,
  checkConsumable,
  checkCost,
  checkDefend,
  checkInteract,
  type Check,
} from './checks.js';
import type { Command, CommandError, CommandTarget, ExecutionOptions } from './types.js';

export type ActionKind = 'move' | 'defend' | 'endTurn' | 'attack' | 'ability' | 'item' | 'interact';

export interface ActionInfo {
  key: string;
  kind: ActionKind;
  /** Id da definição (arma, habilidade, item, objeto) ou da ação básica. */
  id: string;
  name: string;
  cost: string;
  target: 'none' | 'self' | 'cell' | 'unit' | 'object';
  available: boolean;
  reason: CommandError | null;
  /** Comando pronto para executar (ações sem alvo ou com alvo já definido). */
  command: Command | null;
  /** Para ações com alvo: quantas células/alvos válidos existem agora. */
  validTargets?: number;
}

const fmtCost = (c: Cost): string => `${c.ap} PA${c.focus ? ` + ${c.focus} Foco` : ''}`;
const first = (...checks: Array<() => Check>): Check => {
  for (const c of checks) {
    const r = c();
    if (r) return r;
  }
  return null;
};
const noTarget: CommandError = { code: 'NO_VALID_TARGET', message: 'Nenhum alvo válido no alcance' };

/** Células candidatas dentro do alcance, para sondar alvos válidos. */
function candidateCells(state: GameState, from: Coord, rule: TargetingRule): Coord[] {
  const max = rule.range ?? 0;
  return allCoords(state.map).filter((c) => distance(from, c) <= max && distance(from, c) >= (rule.minRange ?? 0));
}

function countValidTargets(
  state: GameState,
  catalog: Catalog,
  actor: Unit,
  rule: TargetingRule,
  build: (t: CommandTarget) => Command,
  options: ExecutionOptions,
): number {
  let n = 0;
  for (const c of candidateCells(state, actor.pos, rule)) {
    if (applyCommand(state, catalog, build({ kind: 'cell', ...c }), options).ok) n++;
  }
  return n;
}

/** Ações do próprio personagem (barra de ações). */
export function listUnitActions(state: GameState, catalog: Catalog, unitId: EntityId, options: ExecutionOptions = {}): ActionInfo[] {
  const actor = state.units[unitId];
  if (!actor || actor.flags.isDummy) return [];
  const base = checkActor(state, unitId, options);
  const out: ActionInfo[] = [];
  const push = (info: Omit<ActionInfo, 'available'>) => out.push({ ...info, available: info.reason === null });

  // Mover
  {
    let reason = first(() => base, () => checkCanMove(state, catalog, actor));
    let validTargets = 0;
    if (!reason) {
      validTargets = reachableCells(state, catalog, actor.pos, actor.mp).size - 1;
      if (validTargets === 0) reason = { code: 'NOT_ENOUGH_MP', message: actor.mp === 0 ? 'Sem PM' : 'Nenhuma célula alcançável' };
    }
    push({ key: 'move', kind: 'move', id: 'action.move', name: 'Mover', cost: `${actor.mp} PM disponíveis`, target: 'cell', reason, command: null, validTargets });
  }

  for (const weaponId of actor.weapons) {
    const w = catalog.items[weaponId];
    if (w?.kind !== 'weapon') continue;
    let reason = first(() => base, () => checkCost(actor, w.cost, options));
    const build = (target: CommandTarget): Command => ({ type: 'BASIC_ATTACK', actorId: actor.id, weaponId: w.id, target });
    const validTargets = reason ? undefined : countValidTargets(state, catalog, actor, w.target, build, options);
    if (!reason && validTargets === 0) reason = noTarget;
    push({ key: `attack:${w.id}`, kind: 'attack', id: w.id, name: `Ataque: ${w.name}`, cost: fmtCost(w.cost), target: 'cell', reason, command: null, ...(validTargets !== undefined ? { validTargets } : {}) });
  }

  for (const abilityId of actor.abilities) {
    const ab = catalog.abilities[abilityId];
    if (!ab) continue;
    let reason = first(() => base, () => checkAbility(state, catalog, actor, ab, options), () => checkCost(actor, ab.cost, options));
    const self = ab.target.kind === 'self';
    const build = (target: CommandTarget): Command => ({ type: 'USE_ABILITY', actorId: actor.id, abilityId: ab.id, target });
    const validTargets = reason || self ? undefined : countValidTargets(state, catalog, actor, ab.target, build, options);
    if (!reason && validTargets === 0) reason = noTarget;
    push({
      key: `ability:${ab.id}`, kind: 'ability', id: ab.id, name: ab.name, cost: fmtCost(ab.cost),
      target: self ? 'self' : ab.target.kind, reason, command: self ? build({ kind: 'self' }) : null,
      ...(validTargets !== undefined ? { validTargets } : {}),
    });
  }

  for (const itemId of actor.consumables) {
    const item = catalog.items[itemId];
    if (item?.kind !== 'consumable') continue;
    let reason = first(() => base, () => checkConsumable(actor, item), () => checkCost(actor, item.cost, options));
    const self = item.target.kind === 'self';
    const build = (target: CommandTarget): Command => ({ type: 'USE_ITEM', actorId: actor.id, itemId: item.id, target });
    const validTargets = reason || self ? undefined : countValidTargets(state, catalog, actor, item.target, build, options);
    if (!reason && validTargets === 0) reason = noTarget;
    push({
      key: `item:${item.id}`, kind: 'item', id: item.id, name: item.name, cost: fmtCost(item.cost),
      target: self ? 'self' : item.target.kind, reason, command: self ? build({ kind: 'self' }) : null,
      ...(validTargets !== undefined ? { validTargets } : {}),
    });
  }

  push({
    key: 'defend', kind: 'defend', id: 'action.defend', name: 'Defender', cost: fmtCost(DEFEND_SHIELD.cost), target: 'self',
    reason: first(() => base, () => checkDefend(actor, options)), command: { type: 'DEFEND', actorId: actor.id },
  });
  push({
    key: 'endTurn', kind: 'endTurn', id: 'action.end_turn', name: 'Encerrar turno', cost: 'sem custo', target: 'none',
    reason: base, command: { type: 'END_TURN', actorId: actor.id },
  });
  return out;
}

/** Ações que `actorId` pode fazer sobre uma entidade específica (objeto ou outro personagem). */
export function listActionsOnTarget(
  state: GameState,
  catalog: Catalog,
  actorId: EntityId,
  targetId: EntityId,
  options: ExecutionOptions = {},
): ActionInfo[] {
  const actor = state.units[actorId];
  if (!actor || actor.flags.isDummy || actorId === targetId) return [];
  const target: CommandTarget = { kind: 'entity', id: targetId };
  const out: ActionInfo[] = [];
  const probe = (command: Command): CommandError | null => {
    const r = applyCommand(state, catalog, command, options);
    return r.ok ? null : r.error;
  };

  const obj = state.objects[targetId];
  if (obj && catalog.objects[obj.defId]?.interaction) {
    const def = catalog.objects[obj.defId]!;
    const command: Command = { type: 'INTERACT', actorId, objectId: obj.id };
    const reason = first(() => checkActor(state, actorId, options), () => checkInteract(state, catalog, actor, obj, options));
    out.push({
      key: `interact:${obj.id}`, kind: 'interact', id: def.id, name: interactLabel(def.interaction!.kind, obj.state),
      cost: fmtCost(INTERACT_COST), target: 'object', available: !reason, reason, command,
    });
  }

  for (const weaponId of actor.weapons) {
    const w = catalog.items[weaponId];
    if (w?.kind !== 'weapon') continue;
    const command: Command = { type: 'BASIC_ATTACK', actorId, weaponId: w.id, target };
    const reason = probe(command);
    out.push({ key: `attack:${w.id}`, kind: 'attack', id: w.id, name: `Ataque: ${w.name}`, cost: fmtCost(w.cost), target: 'cell', available: !reason, reason, command });
  }
  for (const abilityId of actor.abilities) {
    const ab = catalog.abilities[abilityId];
    if (!ab || ab.target.kind === 'self') continue;
    const command: Command = { type: 'USE_ABILITY', actorId, abilityId: ab.id, target };
    const reason = probe(command);
    out.push({ key: `ability:${ab.id}`, kind: 'ability', id: ab.id, name: ab.name, cost: fmtCost(ab.cost), target: ab.target.kind, available: !reason, reason, command });
  }
  for (const itemId of actor.consumables) {
    const item = catalog.items[itemId];
    if (item?.kind !== 'consumable' || item.target.kind === 'self') continue;
    const command: Command = { type: 'USE_ITEM', actorId, itemId: item.id, target };
    const reason = probe(command);
    out.push({ key: `item:${item.id}`, kind: 'item', id: item.id, name: item.name, cost: fmtCost(item.cost), target: item.target.kind, available: !reason, reason, command });
  }
  return out;
}

function interactLabel(kind: string, state: string): string {
  switch (kind) {
    case 'toggleDoor': return state === 'open' ? 'Fechar porta' : 'Abrir porta';
    case 'toggleLinked': return 'Acionar alavanca';
    case 'grantConsumable': return 'Abrir baú';
    case 'restoreFocus': return 'Usar altar de Foco';
    case 'emitWater': return 'Usar cisterna';
    default: return 'Interagir';
  }
}

// ---------------------------------------------------------------------------
// Mira (cliente 3D, seção 14.8): células-alvo, área afetada e chance de acerto.
// Tudo é prévia: o motor recalcula e valida o comando na confirmação.
// ---------------------------------------------------------------------------

/** Ação com alvo escolhido pelo jogador (arma, habilidade ou consumível). */
export interface TargetedAction {
  kind: 'attack' | 'ability' | 'item';
  id: string;
}

/** Célula candidata dentro do alcance, válida ou não (com o motivo do motor). */
export interface TargetCellInfo {
  cell: Coord;
  valid: boolean;
  reason: CommandError | null;
}

/** Comando da ação sobre um alvo (célula ou entidade). */
export function targetedCommand(actorId: EntityId, action: TargetedAction, target: CommandTarget): Command {
  switch (action.kind) {
    case 'attack': return { type: 'BASIC_ATTACK', actorId, weaponId: action.id, target };
    case 'ability': return { type: 'USE_ABILITY', actorId, abilityId: action.id, target };
    case 'item': return { type: 'USE_ITEM', actorId, itemId: action.id, target };
  }
}

/** Regra de alvo e efeitos da definição (null se o id não corresponde ao tipo). */
function targetedDefinition(catalog: Catalog, action: TargetedAction): { target: TargetingRule; effects: EffectOp[]; attackRoll: boolean } | null {
  if (action.kind === 'ability') {
    const ab = catalog.abilities[action.id];
    return ab ? { target: ab.target, effects: ab.effects, attackRoll: !!ab.attackRoll } : null;
  }
  const item = catalog.items[action.id];
  if (action.kind === 'attack' && item?.kind === 'weapon') {
    return { target: item.target, effects: [{ op: 'damage', selector: 'targetCellOccupants', amount: item.damage, damageType: item.damageType }], attackRoll: true };
  }
  if (action.kind === 'item' && item?.kind === 'consumable') return { target: item.target, effects: item.effects, attackRoll: false };
  return null;
}

/**
 * Células de chão dentro do alcance da ação (exceto a do executor), cada uma marcada como
 * válida ou não. A validade vem de sondar `applyCommand` com alvo de célula (como `countValidTargets`).
 */
export function listTargetCells(
  state: GameState,
  catalog: Catalog,
  actorId: EntityId,
  action: TargetedAction,
  options: ExecutionOptions = {},
): TargetCellInfo[] {
  const actor = state.units[actorId];
  const def = targetedDefinition(catalog, action);
  if (!actor || !def || def.target.kind === 'self') return [];
  return candidateCells(state, actor.pos, def.target)
    // A célula do próprio personagem fica de fora (o motor aceita, mas atingiria o executor).
    .filter((c) => getCell(state.map, c)?.terrain === 'ground' && distance(c, actor.pos) > 0)
    .map((cell) => {
      const r = applyCommand(state, catalog, targetedCommand(actorId, action, { kind: 'cell', ...cell }), options);
      return { cell, valid: r.ok, reason: r.ok ? null : r.error };
    });
}

/** Só as células-alvo válidas agora. */
export function listValidTargets(
  state: GameState,
  catalog: Catalog,
  actorId: EntityId,
  action: TargetedAction,
  options: ExecutionOptions = {},
): Coord[] {
  return listTargetCells(state, catalog, actorId, action, options).filter((t) => t.valid).map((t) => t.cell);
}

/**
 * Células afetadas se a ação mirar `targetCell`: a cruz (centro + 4 vizinhas) quando algum
 * efeito usa os seletores `crossArea`/`crossAreaOccupants` (Espinhos, Frasco de óleo), senão
 * só a célula alvo. Vem dos seletores da definição — o mesmo dado que o executor usa.
 */
export function previewArea(state: GameState, catalog: Catalog, _actorId: EntityId, action: TargetedAction, targetCell: Coord): Coord[] {
  const def = targetedDefinition(catalog, action);
  if (!def) return [];
  const cross = def.effects.some((e) => 'selector' in e && (e.selector === 'crossArea' || e.selector === 'crossAreaOccupants'));
  return (cross ? crossArea(targetCell) : [targetCell]).filter((c) => getCell(state.map, c)?.terrain === 'ground');
}

/** Probabilidade (0–1) de acertar: d20 + bônus ≥ Defesa; 1 natural erra, 20 natural acerta. */
export function attackHitChance(attackBonus: number, defense: number): number {
  let hits = 0;
  for (let natural = 1; natural <= 20; natural++) if (natural === 20 || (natural !== 1 && natural + attackBonus >= defense)) hits++;
  return hits / 20;
}

export interface TargetPreview {
  entityId: EntityId;
  entity: 'unit' | 'object';
  /** `true`: há jogada de ataque contra este alvo; `false`: atingido automaticamente. */
  attackRoll: boolean;
  /** Chance de acerto (1 quando automático). */
  hitChance: number;
  defense: number | null;
  attackBonus: number;
}

/**
 * Entidades na área da ação mirando `targetCell` e a chance de acerto de cada uma. Só o
 * personagem na célula alvo sofre jogada de ataque (como em `executeAttack`); objetos e os
 * demais ocupantes da área são atingidos automaticamente.
 */
export function previewTargets(state: GameState, catalog: Catalog, actorId: EntityId, action: TargetedAction, targetCell: Coord): TargetPreview[] {
  const actor = state.units[actorId];
  const def = targetedDefinition(catalog, action);
  if (!actor || !def) return [];
  const victim = unitAt(state, targetCell);
  return previewArea(state, catalog, actorId, action, targetCell).flatMap((c) =>
    entitiesAt(state, c)
      .filter((e) => e.id !== actor.id && (e.entity !== 'object' || e.state !== 'destroyed'))
      .map((e): TargetPreview => {
        const rolls = def.attackRoll && e.entity === 'unit' && e.id === victim?.id;
        return {
          entityId: e.id,
          entity: e.entity,
          attackRoll: rolls,
          hitChance: rolls ? attackHitChance(actor.attackBonus, (e as Unit).defense) : 1,
          defense: e.entity === 'unit' ? e.defense : null,
          attackBonus: actor.attackBonus,
        };
      }),
  );
}
