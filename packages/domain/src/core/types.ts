/** Coordenada lógica de uma célula. `floor` 0 = térreo. */
export interface Coord {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export type EntityId = string;

export type ElementType = 'fire' | 'cold' | 'nature' | 'arcane';
export type DamageType = 'physical' | ElementType;

export const DAMAGE_TYPES: readonly DamageType[] = ['physical', 'fire', 'cold', 'nature', 'arcane'];
export const ELEMENT_TYPES: readonly ElementType[] = ['fire', 'cold', 'nature', 'arcane'];

export type Resistances = Partial<Record<ElementType, number>>;

/** Versão das regras do motor. Incrementar quando uma regra muda de comportamento. */
export const RULES_VERSION = 1;
