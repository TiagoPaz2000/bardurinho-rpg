/**
 * Dados do combate (d4, d6, d8, d10, d12, d20) com gerador determinístico.
 *
 * O estado guarda a semente e o número de rolagens já feitas: a mesma partida, com os
 * mesmos comandos, produz sempre as mesmas rolagens (replay, testes, servidor autoritativo).
 *
 * Modos:
 * - `random`: rolagens pseudoaleatórias a partir da semente.
 * - `average`: cada dado vale a média arredondada para cima (d4=3, d6=4, d8=5, d10=6,
 *   d12=7, d20=11). Usado em testes de regras e simulações de balanceamento.
 * Rolagens forçadas (`forced`, só debug) têm prioridade sobre o modo.
 */
export const DIE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DieSides = (typeof DIE_SIDES)[number];

/** Valor fixo (`18`) ou fórmula (`2d6+10`, `1d8`, `1d4+1`, `2d6+1d4+3`). */
export type DiceExpr = number | string;

export interface DiceTerm {
  count: number;
  sides: DieSides;
}

export interface ParsedDice {
  terms: DiceTerm[];
  bonus: number;
}

export interface RngState {
  mode: 'random' | 'average';
  seed: number;
  /** Rolagens já consumidas (avança a sequência). */
  draws: number;
  /** Debug: próximos resultados forçados, consumidos em ordem. */
  forced: number[];
}

export function parseDice(expr: DiceExpr): ParsedDice {
  if (typeof expr === 'number') return { terms: [], bonus: expr };
  const clean = expr.replace(/\s+/g, '').toLowerCase();
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(clean)) throw new Error(`Fórmula de dados inválida: ${expr}`);
  const out: ParsedDice = { terms: [], bonus: 0 };
  for (const m of clean.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
    const sign = m[1] === '-' ? -1 : 1;
    const part = m[2]!;
    if (part.includes('d')) {
      const [c, s] = part.split('d');
      const sides = Number(s);
      if (!DIE_SIDES.includes(sides as DieSides)) throw new Error(`Dado não suportado: d${sides} (use d4, d6, d8, d10, d12 ou d20)`);
      if (sign < 0) throw new Error(`Dados negativos não são suportados: ${expr}`);
      out.terms.push({ count: c === '' ? 1 : Number(c), sides: sides as DieSides });
    } else {
      out.bonus += sign * Number(part);
    }
  }
  return out;
}

export function isValidDice(expr: DiceExpr): boolean {
  try {
    parseDice(expr);
    return true;
  } catch {
    return false;
  }
}

export function formatDice(expr: DiceExpr): string {
  if (typeof expr === 'number') return String(expr);
  const p = parseDice(expr);
  const dice = p.terms.map((t) => `${t.count}d${t.sides}`).join('+');
  const bonus = p.bonus === 0 ? '' : p.bonus > 0 ? `+${p.bonus}` : String(p.bonus);
  return (dice || '0') + bonus;
}

/** Faixa e média da fórmula. */
export function diceStats(expr: DiceExpr): { min: number; max: number; average: number } {
  const p = parseDice(expr);
  let min = p.bonus;
  let max = p.bonus;
  let average = p.bonus;
  for (const t of p.terms) {
    min += t.count;
    max += t.count * t.sides;
    average += (t.count * (t.sides + 1)) / 2;
  }
  return { min, max, average };
}

export const averageDieValue = (sides: number): number => Math.ceil((sides + 1) / 2);

/** Hash 32 bits (mulberry32) de semente + índice: sequência reproduzível, sem estado oculto. */
function hash32(seed: number, index: number): number {
  let t = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Rola um dado, avançando o estado do gerador. */
export function rollDie(rng: RngState, sides: number): number {
  const forced = rng.forced.shift();
  rng.draws += 1;
  if (forced !== undefined) return Math.min(sides, Math.max(1, Math.round(forced)));
  if (rng.mode === 'average') return averageDieValue(sides);
  return 1 + Math.floor(hash32(rng.seed, rng.draws - 1) * sides);
}

export interface DiceRoll {
  formula: string;
  rolls: Array<{ sides: number; value: number }>;
  bonus: number;
  total: number;
  critical: boolean;
}

/** Rola a fórmula. Em crítico, os dados (não o bônus) são rolados em dobro. */
export function rollDice(rng: RngState, expr: DiceExpr, options: { critical?: boolean } = {}): DiceRoll {
  const p = parseDice(expr);
  const rolls: DiceRoll['rolls'] = [];
  const factor = options.critical ? 2 : 1;
  for (const t of p.terms) {
    for (let i = 0; i < t.count * factor; i++) rolls.push({ sides: t.sides, value: rollDie(rng, t.sides) });
  }
  const total = Math.max(0, rolls.reduce((s, r) => s + r.value, 0) + p.bonus);
  return { formula: formatDice(expr), rolls, bonus: p.bonus, total, critical: !!options.critical };
}

export const createRng = (seed = 1, mode: RngState['mode'] = 'random'): RngState => ({ mode, seed: seed >>> 0, draws: 0, forced: [] });
