import type { EntityId } from '../core/types.js';
import { damageUnit } from '../combat/damage.js';
import { emit, withCause, type ResolutionContext } from '../state/context.js';
import type { StatusInstance, Unit } from '../state/types.js';

function initialRemaining(ctx: ResolutionContext, statusId: string): number {
  const def = ctx.catalog.statuses[statusId];
  if (!def) throw new Error(`Estado desconhecido: ${statusId}`);
  // Estados manuais não usam contagem (0), mantendo o estado serializável em JSON.
  return def.duration.kind === 'manual' ? 0 : def.duration.count;
}

/** Reaplicar renova a duração, sem somar instâncias (seção 5.1). */
export function applyStatus(
  ctx: ResolutionContext,
  unit: Unit,
  statusId: string,
  sourceId: EntityId | null,
  sourceDefinitionId: string | null,
): StatusInstance | null {
  if (!unit.alive) return null;
  const remaining = initialRemaining(ctx, statusId);
  const existing = unit.statuses.find((s) => s.statusId === statusId);
  if (existing) {
    existing.remaining = remaining;
    existing.pendingStart = true;
    existing.sourceId = sourceId;
    existing.sourceDefinitionId = sourceDefinitionId;
    emit(ctx, 'STATUS_REFRESHED', { unitId: unit.id, statusId, remaining: remaining });
    return existing;
  }
  const instance: StatusInstance = { statusId, sourceId, sourceDefinitionId, remaining, pendingStart: true };
  unit.statuses.push(instance);
  emit(ctx, 'STATUS_APPLIED', {
    unitId: unit.id,
    statusId,
    remaining: remaining,
    duration: ctx.catalog.statuses[statusId]!.duration,
  });
  return instance;
}

export function removeStatus(ctx: ResolutionContext, unit: Unit, statusId: string, reason: string): boolean {
  const index = unit.statuses.findIndex((s) => s.statusId === statusId);
  if (index < 0) return false;
  unit.statuses.splice(index, 1);
  emit(ctx, 'STATUS_REMOVED', { unitId: unit.id, statusId, reason });
  return true;
}

function expire(ctx: ResolutionContext, unit: Unit, instance: StatusInstance): void {
  unit.statuses = unit.statuses.filter((s) => s !== instance);
  emit(ctx, 'STATUS_EXPIRED', { unitId: unit.id, statusId: instance.statusId });
}

/** Início do turno do portador: ativa estados pendentes e aplica ticks de dano. */
export function onStatusesTurnStart(ctx: ResolutionContext, unit: Unit): void {
  for (const instance of [...unit.statuses]) {
    if (!unit.alive) return;
    const def = ctx.catalog.statuses[instance.statusId];
    if (!def) continue;
    instance.pendingStart = false;
    if (def.duration.kind !== 'targetTurnStarts') continue;
    if (def.tickDamage) {
      withCause(ctx, { sourceId: instance.sourceId, definitionId: def.id }, () => {
        emit(ctx, 'STATUS_TICK', {
          unitId: unit.id,
          statusId: def.id,
          damage: def.tickDamage!.amount,
          remaining: instance.remaining - 1,
        });
        damageUnit(ctx, unit, def.tickDamage!.amount, def.tickDamage!.damageType, { via: def.id });
      });
    }
    instance.remaining -= 1;
    if (instance.remaining <= 0 && unit.statuses.includes(instance)) expire(ctx, unit, instance);
  }
}

/** Fim do turno do portador: consome estados que duram "durante o próximo turno". */
export function onStatusesTurnEnd(ctx: ResolutionContext, unit: Unit): void {
  for (const instance of [...unit.statuses]) {
    const def = ctx.catalog.statuses[instance.statusId];
    if (!def || def.duration.kind !== 'targetTurns' || instance.pendingStart) continue;
    instance.remaining -= 1;
    if (instance.remaining <= 0) expire(ctx, unit, instance);
  }
}

/** Modificador de PM ativo (ex.: Lentidão −2). */
export function mpModifier(ctx: ResolutionContext, unit: Unit): number {
  let total = 0;
  for (const s of unit.statuses) {
    if (s.pendingStart) continue;
    total += ctx.catalog.statuses[s.statusId]?.modifiers?.mp ?? 0;
  }
  return total;
}

