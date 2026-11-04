/**
 * Rolagens no contexto de resolução: registram eventos `DICE_ROLLED` / `ATTACK_ROLLED` / `SAVE_ROLLED`
 * para os logs, a timeline e (Fase 2) a apresentação dos dados na tela.
 */
import { parseDice, rollDice, rollDie, type DiceExpr } from '../core/dice.js';
import type { EntityId } from '../core/types.js';
import { emit, type ResolutionContext } from '../state/context.js';
import type { Unit } from '../state/types.js';

/** Resolve uma fórmula. Valores fixos não geram evento nem consomem o gerador. */
export function rollAmount(
  ctx: ResolutionContext,
  expr: DiceExpr,
  purpose: string,
  options: { critical?: boolean; targetId?: EntityId } = {},
): number {
  const parsed = parseDice(expr);
  if (parsed.terms.length === 0) return parsed.bonus;
  const r = rollDice(ctx.state.rng, expr, { critical: options.critical ?? false });
  emit(ctx, 'DICE_ROLLED', { purpose, targetId: options.targetId ?? null, ...r });
  return r.total;
}

export interface AttackRoll {
  natural: number;
  bonus: number;
  total: number;
  defense: number;
  hit: boolean;
  critical: boolean;
}

/** d20 + bônus de ataque contra a Defesa. 1 natural erra sempre; 20 natural é crítico. */
export function rollAttack(ctx: ResolutionContext, attacker: Unit, target: Unit): AttackRoll {
  const natural = rollDie(ctx.state.rng, 20);
  const bonus = attacker.attackBonus;
  const total = natural + bonus;
  const critical = natural === 20;
  const hit = critical || (natural !== 1 && total >= target.defense);
  const result: AttackRoll = { natural, bonus, total, defense: target.defense, hit, critical };
  emit(ctx, 'ATTACK_ROLLED', { attackerId: attacker.id, targetId: target.id, ...result });
  return result;
}

export interface SaveRoll {
  natural: number;
  total: number;
  dc: number;
  success: boolean;
}

/** Teste de resistência: d20 contra a CD. 1 natural falha sempre; 20 natural passa sempre. */
export function rollSave(ctx: ResolutionContext, target: Unit, dc: number): SaveRoll {
  const natural = rollDie(ctx.state.rng, 20);
  const success = natural === 20 || (natural !== 1 && natural >= dc);
  const result: SaveRoll = { natural, total: natural, dc, success };
  emit(ctx, 'SAVE_ROLLED', { unitId: target.id, ...result });
  return result;
}

/** Probabilidade (0–1) de passar no teste de resistência contra `dc`. */
export function saveSuccessChance(dc: number): number {
  let ok = 0;
  for (let natural = 1; natural <= 20; natural++) if (natural === 20 || (natural !== 1 && natural >= dc)) ok++;
  return ok / 20;
}
