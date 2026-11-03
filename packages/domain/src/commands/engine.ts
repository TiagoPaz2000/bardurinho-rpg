/**
 * Processador de comandos (seção 11.2): validar → simular em estado candidato →
 * resolver consequências → confirmar. Determinístico: mesmo estado + mesmo comando
 * produzem sempre o mesmo resultado e os mesmos eventos.
 */
import { distance, sameCoord } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import { grantShield } from '../combat/damage.js';
import { getCell } from '../map/grid.js';
import { hasLineOfSight } from '../map/lineOfSight.js';
import { findPath } from '../map/pathfinding.js';
import type { Catalog, ConsumableDefinition, Cost, EffectOp, TargetingRule } from '../rules/definitions.js';
import { createContext, emit, type ResolutionContext } from '../state/context.js';
import type { GameEvent } from '../state/events.js';
import { getEntity, hasStatusFlag, unitAt } from '../state/queries.js';
import type { Entity, GameState, MapObject, Unit } from '../state/types.js';
import { createScope, executeEffects, restoreResource, type EffectTarget } from '../effects/ops.js';
import { walkPath } from '../effects/movement.js';
import { emitStimulus } from '../effects/reactions.js';
import { setSurfaceDirect } from '../effects/surfaces.js';
import { planDash } from '../effects/dash.js';
import { checkVictory, endTurn, finishMatch, startMatch } from '../turns/turns.js';
import { resetDummy } from '../state/factory.js';
import type { Command, CommandError, CommandErrorCode, CommandTarget, ExecutionOptions } from './types.js';
import { VISIBILITY_TUNING, areEnemies, canDetectUnit, isHidden, isObserver, teamDetects } from '../visibility/visibility.js';
import { removeStatus } from '../effects/statuses.js';
import { livingUnits } from '../state/queries.js';
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
  checkWeapon,
  type Check,
} from './checks.js';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; error: CommandError };

class Rejection extends Error {
  constructor(public readonly code: CommandErrorCode, message: string) {
    super(message);
  }
}

const reject = (code: CommandErrorCode, message: string): never => {
  throw new Rejection(code, message);
};

/** Lança a rejeição de uma pré-condição que falhou. */
const fail = (check: Check): void => {
  if (check) reject(check.code, check.message);
};

export function applyCommand(
  state: GameState,
  catalog: Catalog,
  command: Command,
  options: ExecutionOptions = {},
): CommandResult {
  // Etapa 8: estado candidato. O estado original nunca é modificado.
  const candidate = structuredClone(state);
  const commandSeq = candidate.nextCommandSeq++;
  const ctx = createContext(candidate, catalog, {
    commandSeq,
    sourceId: 'actorId' in command ? command.actorId : null,
  });
  try {
    handle(ctx, command, options);
    revealHiddenUnits(ctx);
    checkVictory(ctx);
    return { ok: true, state: candidate, events: ctx.events };
  } catch (err) {
    if (err instanceof Rejection) return { ok: false, state, error: { code: err.code, message: err.message } };
    throw err;
  }
}

/** Aplica uma sequência de comandos, parando no primeiro erro. Útil para replay e testes. */
export function applyCommands(
  state: GameState,
  catalog: Catalog,
  commands: Command[],
  options: ExecutionOptions = {},
): { state: GameState; events: GameEvent[]; errors: Array<{ index: number; error: CommandError }> } {
  let current = state;
  const events: GameEvent[] = [];
  const errors: Array<{ index: number; error: CommandError }> = [];
  commands.forEach((command, index) => {
    const r = applyCommand(current, catalog, command, options);
    if (r.ok) {
      current = r.state;
      events.push(...r.events);
    } else {
      errors.push({ index, error: r.error });
    }
  });
  return { state: current, events, errors };
}

function handle(ctx: ResolutionContext, command: Command, options: ExecutionOptions): void {
  const { state } = ctx;
  if (command.type.startsWith('DEBUG_')) {
    if (!options.allowDebugCommands) reject('DEBUG_DISABLED', 'Comandos de debug estão desativados');
    return handleDebug(ctx, command as Extract<Command, { type: `DEBUG_${string}` }>);
  }
  if (command.type === 'START_MATCH') {
    if (state.status !== 'setup') reject('MATCH_ALREADY_STARTED', 'A partida já começou');
    return startMatch(ctx);
  }
  if ('expectedTurnId' in command && command.expectedTurnId !== undefined && command.expectedTurnId !== state.turn.turnId) {
    reject('STALE_TURN', `Turno esperado ${command.expectedTurnId}, atual ${state.turn.turnId}`);
  }

  const actor = requireActor(ctx, (command as { actorId: string }).actorId, options);
  emit(ctx, 'COMMAND_ACCEPTED', { command });

  switch (command.type) {
    case 'END_TURN':
      return endTurn(ctx);
    case 'SURRENDER': {
      const other = Object.values(state.units).find((u) => !u.flags.isDummy && u.team !== actor.team);
      return finishMatch(ctx, other ? { kind: 'victory', winnerTeam: other.team, reason: 'surrender' } : { kind: 'draw', reason: 'mutualDestruction' });
    }
    case 'MOVE':
      return handleMove(ctx, actor, command.to);
    case 'DEFEND': {
      fail(checkDefend(actor, options));
      spend(ctx, actor, DEFEND_SHIELD.cost, options, 'action.defend');
      actor.defendedThisTurn = true;
      grantShield(ctx, actor, DEFEND_SHIELD.amount, DEFEND_SHIELD.ownTurns, actor.id, 'action.defend');
      return;
    }
    case 'BASIC_ATTACK': {
      const weapon = ctx.catalog.items[command.weaponId];
      if (!weapon || weapon.kind !== 'weapon') return reject('UNKNOWN_DEFINITION', `Arma desconhecida: ${command.weaponId}`);
      fail(checkWeapon(actor, weapon));
      const target = resolveTarget(ctx, actor, command.target, weapon.target);
      spend(ctx, actor, weapon.cost, options, weapon.id);
      emit(ctx, 'ATTACK_PERFORMED', { actorId: actor.id, weaponId: weapon.id, target: target.cell });
      const effects: EffectOp[] = [
        { op: 'damage', selector: 'targetCellOccupants', amount: weapon.damage, damageType: weapon.damageType },
      ];
      executeAttack(ctx, actor, effects, target, weapon.id);
      return;
    }
    case 'USE_ABILITY': {
      const ability = ctx.catalog.abilities[command.abilityId];
      if (!ability) return reject('UNKNOWN_DEFINITION', `Habilidade desconhecida: ${command.abilityId}`);
      fail(checkAbility(ctx.state, ctx.catalog, actor, ability, options));
      const target = resolveTarget(ctx, actor, command.target, ability.target);
      for (const op of ability.effects) {
        if (op.op !== 'dashToTarget') continue;
        const plan = planDash(ctx.state, ctx.catalog, actor, target.cell, op.maxCost);
        if (!plan.ok) reject(plan.error.code, plan.error.message);
      }
      spend(ctx, actor, ability.cost, options, ability.id);
      actor.usesThisTurn[ability.id] = (actor.usesThisTurn[ability.id] ?? 0) + 1;
      if (ability.blockedOwnTurnsAfterUse > 0) {
        // Recarga N: bloqueada nos N turnos próprios seguintes.
        actor.availableFromOwnTurn[ability.id] = actor.ownTurnsStarted + ability.blockedOwnTurnsAfterUse + 1;
        emit(ctx, 'COOLDOWN_STARTED', {
          unitId: actor.id,
          abilityId: ability.id,
          availableFromOwnTurn: actor.availableFromOwnTurn[ability.id],
        });
      }
      emit(ctx, 'ABILITY_USED', { actorId: actor.id, abilityId: ability.id, version: ability.version, target: target.cell });
      if (ability.effects.some((e) => e.op === 'damage')) executeAttack(ctx, actor, ability.effects, target, ability.id);
      else executeEffects(ctx, ability.effects, createScope(actor, target, ability.id));
      return;
    }
    case 'USE_ITEM': {
      const item = ctx.catalog.items[command.itemId];
      if (!item || item.kind !== 'consumable') return reject('UNKNOWN_DEFINITION', `Consumível desconhecido: ${command.itemId}`);
      fail(checkConsumable(actor, item));
      const index = actor.consumables.indexOf(item.id);
      const target = resolveTarget(ctx, actor, command.target ?? { kind: 'self' }, item.target);
      spend(ctx, actor, item.cost, options, item.id);
      actor.consumables.splice(index, 1);
      emit(ctx, 'ITEM_USED', { actorId: actor.id, itemId: item.id, target: target.cell });
      executeEffects(ctx, (item as ConsumableDefinition).effects, createScope(actor, target, item.id));
      return;
    }
    case 'INTERACT':
      return handleInteract(ctx, actor, command.objectId, options);
  }
}


function requireActor(ctx: ResolutionContext, actorId: string, options: ExecutionOptions): Unit {
  fail(checkActor(ctx.state, actorId, options));
  return ctx.state.units[actorId]!;
}

function spend(ctx: ResolutionContext, actor: Unit, cost: Cost, options: ExecutionOptions, definitionId: string): void {
  if (options.ignoreCost) return;
  fail(checkCost(actor, cost, options));
  const focus = cost.focus ?? 0;
  actor.ap -= cost.ap;
  actor.focus -= focus;
  emit(ctx, 'RESOURCE_SPENT', { unitId: actor.id, ap: cost.ap, focus, apAfter: actor.ap, focusAfter: actor.focus, definitionId });
}

function targetCoord(ctx: ResolutionContext, actor: Unit | null, target: CommandTarget): { cell: Coord; entity?: Entity } {
  switch (target.kind) {
    case 'self':
      if (!actor) return reject('INVALID_TARGET', 'Alvo "self" sem conjurador');
      return { cell: actor.pos, entity: actor };
    case 'cell': {
      const cell = { x: target.x, y: target.y, floor: target.floor };
      if (!getCell(ctx.state.map, cell)) reject('INVALID_TARGET', 'Célula fora do mapa');
      return { cell };
    }
    case 'entity': {
      const entity = getEntity(ctx.state, target.id);
      if (!entity) return reject('INVALID_TARGET', `Entidade desconhecida: ${target.id}`);
      return { cell: entity.pos, entity };
    }
  }
}

/** Etapa 7: alcance, andar e linha de visão. */
function resolveTarget(ctx: ResolutionContext, actor: Unit, target: CommandTarget, rule: TargetingRule): EffectTarget {
  if (rule.kind === 'self') return { cell: actor.pos, entity: actor };
  const resolved = targetCoord(ctx, actor, target);
  if (rule.kind === 'unit') {
    const unit = resolved.entity?.entity === 'unit' ? resolved.entity : unitAt(ctx.state, resolved.cell);
    if (!unit || !unit.alive) reject('INVALID_TARGET', 'O alvo precisa ser um personagem vivo');
    resolved.entity = unit;
  }
  const d = distance(actor.pos, resolved.cell);
  if (rule.sameFloor && actor.pos.floor !== resolved.cell.floor) reject('DIFFERENT_FLOOR', 'O alvo precisa estar no mesmo andar');
  if (rule.range !== undefined && d > rule.range) reject('OUT_OF_RANGE', `Distância ${d} > alcance ${rule.range}`);
  if (rule.minRange !== undefined && d < rule.minRange) reject('TOO_CLOSE', `Distância ${d} < mínimo ${rule.minRange}`);
  if (rule.requiresLineOfSight && !hasLineOfSight(ctx.state, ctx.catalog, actor.pos, resolved.cell)) {
    reject('NO_LINE_OF_SIGHT', 'Sem linha de visão');
  }
  // Não é possível mirar diretamente uma unidade inimiga não detectada (pode-se mirar a célula).
  const unitTarget = resolved.entity?.entity === 'unit' ? resolved.entity : undefined;
  if (unitTarget && unitTarget.team !== actor.team && !unitTarget.flags.isDummy && !teamDetects(ctx.state, ctx.catalog, actor.team, unitTarget)) {
    reject('TARGET_NOT_VISIBLE', 'Alvo não visível');
  }
  return resolved;
}

/**
 * Ataque (arma ou habilidade com dano). Se o atacante estava Oculto, o primeiro ataque
 * recebe +4 de dano bruto e encerra a Ocultação (seção 4).
 */
function executeAttack(ctx: ResolutionContext, actor: Unit, effects: EffectOp[], target: EffectTarget, definitionId: string): void {
  const scope = createScope(actor, target, definitionId);
  const fromHiding = isHidden(actor);
  if (fromHiding) scope.rawDamageBonus = VISIBILITY_TUNING.hiddenAttackBonus;
  executeEffects(ctx, effects, scope);
  if (fromHiding) removeStatus(ctx, actor, VISIBILITY_TUNING.hiddenStatusId, 'attacked');
}

/** Após cada comando: unidades Ocultas detectadas por um inimigo são reveladas. */
function revealHiddenUnits(ctx: ResolutionContext): void {
  const units = livingUnits(ctx.state);
  for (const u of units) {
    if (!isHidden(u)) continue;
    const by = units.find((o) => isObserver(o) && areEnemies(o, u) && canDetectUnit(ctx.state, ctx.catalog, o, u));
    if (by) removeStatus(ctx, u, VISIBILITY_TUNING.hiddenStatusId, `revealed_by_${by.id}`);
  }
}

function handleMove(ctx: ResolutionContext, actor: Unit, to: Coord): void {
  fail(checkCanMove(ctx.state, ctx.catalog, actor));
  if (sameCoord(actor.pos, to)) reject('INVALID_TARGET', 'Destino igual à posição atual');
  const path = findPath(ctx.state, ctx.catalog, actor.pos, to, { maxCost: actor.mp });
  if (!path) {
    const unbounded = findPath(ctx.state, ctx.catalog, actor.pos, to);
    if (unbounded) reject('NOT_ENOUGH_MP', `Caminho custa ${unbounded.cost} PM; disponível ${actor.mp}`);
    reject('NO_PATH', 'Destino inalcançável');
  }
  walkPath(ctx, actor, path!.path, path!.stepCosts);
}

function handleInteract(ctx: ResolutionContext, actor: Unit, objectId: string, options: ExecutionOptions): void {
  const obj = ctx.state.objects[objectId]!;
  fail(checkInteract(ctx.state, ctx.catalog, actor, obj, options));
  const def = ctx.catalog.objects[obj.defId]!;
  const interaction = def.interaction!;

  spend(ctx, actor, INTERACT_COST, options, def.id);
  switch (interaction.kind) {
    case 'toggleDoor':
      setObjectState(ctx, obj, obj.state === 'open' ? 'closed' : 'open');
      break;
    case 'toggleLinked': {
      const linked = obj.linkedId ? ctx.state.objects[obj.linkedId] : undefined;
      if (linked && linked.state !== 'destroyed') setObjectState(ctx, linked, linked.state === 'open' ? 'closed' : 'open');
      setObjectState(ctx, obj, obj.state === 'open' ? 'closed' : 'open');
      break;
    }
    case 'grantConsumable':
      actor.consumables.push(interaction.itemId);
      emit(ctx, 'CONSUMABLE_GRANTED', { unitId: actor.id, itemId: interaction.itemId, objectId: obj.id });
      break;
    case 'restoreFocus':
      restoreResource(ctx, actor, 'focus', interaction.amount);
      break;
    case 'emitWater':
      for (const c of [obj.pos, ...neighborsOf(obj.pos)]) emitStimulus(ctx, c, 'water', { sourceId: actor.id, definitionId: def.id });
      break;
  }
  if (obj.usesLeft !== null) {
    obj.usesLeft -= 1;
    if (obj.usesLeft <= 0 && interaction.kind !== 'toggleDoor' && interaction.kind !== 'toggleLinked') setObjectState(ctx, obj, 'used');
  }
}

const neighborsOf = (c: Coord): Coord[] => [
  { ...c, y: c.y - 1 }, { ...c, x: c.x + 1 }, { ...c, y: c.y + 1 }, { ...c, x: c.x - 1 },
];

function setObjectState(ctx: ResolutionContext, obj: MapObject, to: MapObject['state']): void {
  const from = obj.state;
  if (from === to) return;
  obj.state = to;
  emit(ctx, 'OBJECT_STATE_CHANGED', { objectId: obj.id, from, to });
}

function handleDebug(ctx: ResolutionContext, command: Extract<Command, { type: `DEBUG_${string}` }>): void {
  switch (command.type) {
    case 'DEBUG_APPLY_EFFECTS': {
      const source = command.sourceId ? ctx.state.units[command.sourceId] ?? null : null;
      const target = targetCoord(ctx, source, command.target);
      ctx.cause = { ...ctx.cause, sourceId: source?.id ?? null };
      emit(ctx, 'COMMAND_ACCEPTED', { command });
      executeEffects(ctx, command.effects, createScope(source, target, command.definitionId ?? 'debug.effect'));
      return;
    }
    case 'DEBUG_PAINT_SURFACE':
      for (const c of command.cells) setSurfaceDirect(ctx, c, command.surface, command.durationRounds ?? null);
      return;
    case 'DEBUG_SET_UNIT': {
      const unit = ctx.state.units[command.unitId];
      if (!unit) return reject('UNKNOWN_ACTOR', `Personagem desconhecido: ${command.unitId}`);
      Object.assign(unit, command.patch);
      if (unit.hp > 0 && !unit.alive) unit.alive = true;
      return;
    }
    case 'DEBUG_RESET_DUMMY': {
      const unit = ctx.state.units[command.unitId];
      if (!unit) return reject('UNKNOWN_ACTOR', `Personagem desconhecido: ${command.unitId}`);
      resetDummy(ctx.catalog, unit);
      return;
    }
    case 'DEBUG_REMOVE_ENTITY': {
      const { state } = ctx;
      const id = command.entityId;
      if (state.objects[id]) {
        const obj = state.objects[id]!;
        delete state.objects[id];
        emit(ctx, 'ENTITY_REMOVED', { entityId: id, kind: 'object', defId: obj.defId, pos: obj.pos });
        return;
      }
      const unit = state.units[id];
      if (!unit) return reject('INVALID_TARGET', `Entidade desconhecida: ${id}`);
      const index = state.turn.order.indexOf(id);
      const wasActive = state.turn.activeUnitId === id;
      delete state.units[id];
      delete state.surfaceHitsThisTurn[id];
      if (index >= 0) {
        state.turn.order.splice(index, 1);
        if (index <= state.turn.activeIndex) state.turn.activeIndex -= 1;
      }
      emit(ctx, 'ENTITY_REMOVED', { entityId: id, kind: 'unit', pos: unit.pos });
      // Se era a vez dele, o turno passa para o próximo da ordem.
      if (wasActive && state.status === 'active') {
        state.turn.activeUnitId = null;
        endTurn(ctx);
      }
      return;
    }
  }
}
