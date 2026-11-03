/**
 * Rolagens no contexto de resolução: registram eventos `DICE_ROLLED` / `ATTACK_ROLLED`
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
