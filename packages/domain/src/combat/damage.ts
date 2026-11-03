import type { DamageType, EntityId } from '../core/types.js';
import { emit, type ResolutionContext } from '../state/context.js';
import type { Entity, MapObject, Unit } from '../state/types.js';
import { destroyObject } from '../effects/reactions.js';
import { removeStatus } from '../effects/statuses.js';

export interface DamageOptions {
  ignoreArmor?: boolean;
  /** Origem lógica (habilidade, superfície, estado, explosão…), para logs. */
  via?: string;
}

export interface DamageBreakdown {
  targetId: EntityId;
  raw: number;
  damageType: DamageType;
  /** Armadura ou resistência considerada. */
  mitigation: number;
  /** Quanto efetivamente foi mitigado (≤ raw). */
  mitigated: number;
  afterMitigation: number;
  shieldBefore: number;
  shieldAbsorbed: number;
  shieldAfter: number;
  hpDamage: number;
  hpBefore: number;
  hpAfter: number;
  defeated: boolean;
}

/** Armadura para físico; resistência do elemento para os demais (seção 2.3). */
export function mitigationFor(unit: Unit, damageType: DamageType): number {
  return damageType === 'physical' ? unit.armor : (unit.resistances[damageType] ?? 0);
}

/**
 * Cálculo puro: dano após mitigação = max(0, bruto − mitigação);
 * a barreira absorve o resultado e só o restante reduz os PV.
 */
export function computeDamage(
  raw: number,
  mitigation: number,
  shield: number,
  hp: number,
): Pick<DamageBreakdown, 'mitigated' | 'afterMitigation' | 'shieldAbsorbed' | 'shieldAfter' | 'hpDamage' | 'hpAfter'> {
  const afterMitigation = Math.max(0, raw - mitigation);
  const shieldAbsorbed = Math.min(shield, afterMitigation);
  const hpDamage = afterMitigation - shieldAbsorbed;
  return {
    mitigated: raw - afterMitigation,
    afterMitigation,
    shieldAbsorbed,
    shieldAfter: shield - shieldAbsorbed,
    hpDamage,
    hpAfter: hp - hpDamage,
  };
}

export function damageUnit(
  ctx: ResolutionContext,
  unit: Unit,
  raw: number,
  damageType: DamageType,
  options: DamageOptions = {},
): DamageBreakdown | null {
  if (!unit.alive) return null;
  const mitigation = options.ignoreArmor ? 0 : mitigationFor(unit, damageType);
  const shieldBefore = unit.shield?.amount ?? 0;
  const hpBefore = unit.hp;
  const r = computeDamage(raw, mitigation, shieldBefore, unit.hp);
  let hpAfter = r.hpAfter;
  if (unit.flags.immortal && hpAfter < 1) hpAfter = 1;

  if (unit.shield) {
    unit.shield.amount = r.shieldAfter;
    if (unit.shield.amount <= 0) unit.shield = null;
  }
  unit.hp = hpAfter;

  const breakdown: DamageBreakdown = {
    targetId: unit.id,
    raw,
    damageType,
    mitigation,
    mitigated: r.mitigated,
    afterMitigation: r.afterMitigation,
    shieldBefore,
    shieldAbsorbed: r.shieldAbsorbed,
    shieldAfter: r.shieldAfter,
    hpDamage: hpBefore - hpAfter,
    hpBefore,
    hpAfter,
    defeated: hpAfter <= 0,
  };
  emit(ctx, 'DAMAGE_APPLIED', { ...breakdown, via: options.via ?? null });
  if (breakdown.defeated) defeatUnit(ctx, unit);
  // Ocultação termina ao receber dano (seção 4).
  else if (r.afterMitigation > 0) removeStatus(ctx, unit, 'hidden', 'damaged');
  return breakdown;
}

export function defeatUnit(ctx: ResolutionContext, unit: Unit): void {
  if (!unit.alive) return;
  unit.alive = false;
  unit.hp = Math.min(unit.hp, 0);
  unit.shield = null;
  emit(ctx, 'UNIT_DEFEATED', { unitId: unit.id, pos: unit.pos });
}

/** Objetos não possuem armadura no MVP. Indestrutíveis (hp null) ignoram dano. */
export function damageObject(
  ctx: ResolutionContext,
  obj: MapObject,
  raw: number,
  damageType: DamageType,
  options: DamageOptions = {},
): void {
  if (obj.state === 'destroyed' || obj.hp === null) return;
  const hpBefore = obj.hp;
  obj.hp = Math.max(0, obj.hp - raw);
  emit(ctx, 'OBJECT_DAMAGED', {
    objectId: obj.id,
    raw,
    damageType,
    hpBefore,
    hpAfter: obj.hp,
    via: options.via ?? null,
  });
  if (obj.hp <= 0) destroyObject(ctx, obj, 'HP_ZERO');
}

export function damageEntity(
  ctx: ResolutionContext,
  entity: Entity,
  raw: number,
  damageType: DamageType,
  options: DamageOptions = {},
): DamageBreakdown | null {
  if (entity.entity === 'unit') return damageUnit(ctx, entity, raw, damageType, options);
  damageObject(ctx, entity, raw, damageType, options);
  return null;
}

export interface HealResult {
  requested: number;
  effective: number;
  overheal: number;
  hpBefore: number;
  hpAfter: number;
}

export function healUnit(ctx: ResolutionContext, unit: Unit, amount: number): HealResult | null {
  if (!unit.alive) return null;
  const hpBefore = unit.hp;
  unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  const result: HealResult = {
    requested: amount,
    effective: unit.hp - hpBefore,
    overheal: amount - (unit.hp - hpBefore),
    hpBefore,
    hpAfter: unit.hp,
  };
  emit(ctx, 'HEALED', { unitId: unit.id, ...result });
  return result;
}

/**
 * Barreiras não somam: um efeito mais fraco não prolonga nem aumenta uma barreira
 * mais forte (seção 5.1). Uma barreira igual ou maior substitui a atual.
 */
export function grantShield(
  ctx: ResolutionContext,
  unit: Unit,
  amount: number,
  ownTurns: number,
  sourceId: EntityId | null,
  sourceDefinitionId: string | null,
): boolean {
  if (!unit.alive) return false;
  const previous = unit.shield?.amount ?? 0;
  if (unit.shield && unit.shield.amount > amount) {
    emit(ctx, 'SHIELD_GRANTED', { unitId: unit.id, granted: amount, previous, current: previous, applied: false });
    return false;
  }
  unit.shield = {
    amount,
    expiresAtOwnTurn: unit.ownTurnsStarted + ownTurns,
    sourceId,
    sourceDefinitionId,
  };
  emit(ctx, 'SHIELD_GRANTED', { unitId: unit.id, granted: amount, previous, current: amount, applied: true });
  return true;
}
