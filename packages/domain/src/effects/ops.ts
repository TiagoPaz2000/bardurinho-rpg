/**
 * Executor das operações reutilizáveis (seção 8.2). Habilidades, itens, objetos e o
 * Debug Lab descrevem efeitos como listas de `EffectOp`; nenhuma magia tem código próprio.
 */
import { crossArea } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import { damageEntity, grantShield, healUnit } from '../combat/damage.js';
import type { CellSelector, EffectOp, EntitySelector, ResourceKind } from '../rules/definitions.js';
import { emit, withCause, type ResolutionContext } from '../state/context.js';
import { entitiesAt } from '../state/queries.js';
import type { Entity, MapObject, Unit } from '../state/types.js';
import { forceMove } from './movement.js';
import { rollAmount } from '../combat/rolls.js';
import { executeDash, planDash } from './dash.js';
import { emitStimulus } from './reactions.js';
import { applyStatus, removeStatus } from './statuses.js';
import { createSurface, removeSurface } from './surfaces.js';

export interface EffectTarget {
  cell: Coord;
  entity?: Entity;
}

export interface EffectScope {
  actor: Unit | null;
  sourceId: EntityId | null;
  definitionId: string | null;
  target: EffectTarget;
  /** Unidades atingidas por dano nesta mesma execução. */
  hitUnits: Set<EntityId>;
  /** Bônus de dano bruto aplicado a cada operação de dano (ex.: ataque saindo de Oculto). */
  rawDamageBonus?: number;
  /** Interrompe as operações restantes (ex.: atacante morreu durante a Investida). */
  aborted?: boolean;
  /** Personagens que a jogada de ataque errou: ficam fora dos seletores de entidade. */
  missedUnits?: Set<EntityId>;
  /** Personagens atingidos por crítico: dados de dano rolados em dobro. */
  criticalUnits?: Set<EntityId>;
}

export function createScope(
  actor: Unit | null,
  target: EffectTarget,
  definitionId: string | null,
): EffectScope {
  return { actor, sourceId: actor?.id ?? null, definitionId, target, hitUnits: new Set() };
}

const isLive = (e: Entity) => (e.entity === 'unit' ? e.alive : e.state !== 'destroyed');

export function selectEntities(ctx: ResolutionContext, scope: EffectScope, selector: EntitySelector): Entity[] {
  const missed = scope.missedUnits;
  const all = selectEntitiesRaw(ctx, scope, selector);
  return missed?.size ? all.filter((e) => !missed.has(e.id)) : all;
}

function selectEntitiesRaw(ctx: ResolutionContext, scope: EffectScope, selector: EntitySelector): Entity[] {
  switch (selector) {
    case 'self':
      return scope.actor && scope.actor.alive ? [scope.actor] : [];
    case 'targetCellOccupants':
      return scope.target.entity
        ? isLive(scope.target.entity) ? [scope.target.entity] : []
        : entitiesAt(ctx.state, scope.target.cell);
    case 'crossAreaOccupants':
      return crossArea(scope.target.cell).flatMap((c) => entitiesAt(ctx.state, c));
    case 'survivingUnitsHit':
      return [...scope.hitUnits].sort().map((id) => ctx.state.units[id]!).filter((u) => u?.alive);
  }
}

export function selectCells(_ctx: ResolutionContext, scope: EffectScope, selector: CellSelector): Coord[] {
  switch (selector) {
    case 'targetCell':
      return [scope.target.cell];
    case 'crossArea':
      return crossArea(scope.target.cell);
    case 'selfCell':
      return scope.actor ? [scope.actor.pos] : [];
  }
}

const unitsOf = (entities: Entity[]): Unit[] => entities.filter((e): e is Unit => e.entity === 'unit');
const objectsOf = (entities: Entity[]): MapObject[] => entities.filter((e): e is MapObject => e.entity === 'object');

export function executeEffects(ctx: ResolutionContext, effects: EffectOp[], scope: EffectScope): void {
  withCause(ctx, { sourceId: scope.sourceId, definitionId: scope.definitionId }, () => {
    for (const op of effects) {
      if (scope.aborted) break;
      executeOp(ctx, op, scope);
    }
  });
}

export function executeOp(ctx: ResolutionContext, op: EffectOp, scope: EffectScope): void {
  const source = { sourceId: scope.sourceId, definitionId: scope.definitionId };
  switch (op.op) {
    case 'damage': {
      for (const e of selectEntities(ctx, scope, op.selector)) {
        const amount = rollAmount(ctx, op.amount, 'damage', { critical: scope.criticalUnits?.has(e.id) ?? false, targetId: e.id });
        const r = damageEntity(ctx, e, amount + (scope.rawDamageBonus ?? 0), op.damageType, {
          ignoreArmor: op.ignoreArmor ?? false,
          via: scope.definitionId ?? undefined,
        });
        if (r) scope.hitUnits.add(e.id);
      }
      return;
    }
    case 'heal':
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) healUnit(ctx, u, rollAmount(ctx, op.amount, 'heal', { targetId: u.id }));
      return;
    case 'applyStatus':
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) {
        applyStatus(ctx, u, op.statusId, scope.sourceId, scope.definitionId);
      }
      return;
    case 'removeStatus':
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) {
        removeStatus(ctx, u, op.statusId, op.reason ?? scope.definitionId ?? 'effect');
      }
      return;
    case 'grantShield':
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) {
        grantShield(ctx, u, op.amount, op.ownTurns, scope.sourceId, scope.definitionId);
      }
      return;
    case 'restoreResource':
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) {
        restoreResource(ctx, u, op.resource, rollAmount(ctx, op.amount, `restore_${op.resource}`, { targetId: u.id }));
      }
      return;
    case 'dashToTarget': {
      if (!scope.actor) return;
      const r = planDash(ctx.state, ctx.catalog, scope.actor, scope.target.cell, op.maxCost);
      if (!r.ok || !executeDash(ctx, scope.actor, r.plan, scope.definitionId)) scope.aborted = true;
      return;
    }
    case 'forceMove': {
      const origin = scope.actor?.pos ?? scope.target.cell;
      for (const u of unitsOf(selectEntities(ctx, scope, op.selector))) {
        forceMove(ctx, u, origin, op.distance, scope.definitionId);
      }
      return;
    }
    case 'createSurface':
      for (const c of selectCells(ctx, scope, op.selector)) createSurface(ctx, c, op.surface, op.durationRounds, source);
      return;
    case 'removeSurface':
      for (const c of selectCells(ctx, scope, op.selector)) removeSurface(ctx, c, scope.definitionId ?? 'effect', op.surface);
      return;
    case 'emitStimulus':
      for (const c of selectCells(ctx, scope, op.selector)) emitStimulus(ctx, c, op.stimulus, source);
      return;
    case 'changeObjectState':
      for (const o of objectsOf(selectEntities(ctx, scope, op.selector))) {
        const from = o.state;
        o.state = op.state;
        emit(ctx, 'OBJECT_STATE_CHANGED', { objectId: o.id, from, to: op.state });
      }
      return;
  }
}

const RESOURCE_MAX: Record<ResourceKind, (u: Unit) => number> = {
  hp: (u) => u.maxHp,
  ap: (u) => u.maxAp,
  mp: (u) => u.maxMp,
  focus: (u) => u.maxFocus,
};

export function restoreResource(ctx: ResolutionContext, unit: Unit, resource: ResourceKind, amount: number): void {
  if (!unit.alive) return;
  if (resource === 'hp') {
    healUnit(ctx, unit, amount);
    return;
  }
  const before = unit[resource];
  unit[resource] = Math.min(RESOURCE_MAX[resource](unit), before + amount);
  emit(ctx, 'RESOURCE_RESTORED', { unitId: unit.id, resource, requested: amount, before, after: unit[resource] });
}
