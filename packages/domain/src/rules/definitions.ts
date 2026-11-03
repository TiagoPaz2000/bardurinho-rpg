import type { DamageType, Resistances } from '../core/types.js';
import type { DiceExpr } from '../core/dice.js';
import type { SurfaceKind } from '../map/grid.js';

/** Metadados comuns a toda definição de conteúdo (seção 8.1 — camada "Definição"). */
export interface DefinitionBase {
  id: string;
  version: number;
  name: string;
  tags: string[];
  description?: string;
}

export interface Presentation {
  iconId?: string;
  animationId?: string;
  vfxId?: string;
}

// ---------------------------------------------------------------------------
// Seletores e operações reutilizáveis (seção 8.2)
// ---------------------------------------------------------------------------

export type EntitySelector =
  | 'self'
  /** Entidade alvo (alvo do tipo `entity`) ou ocupantes da célula alvo. */
  | 'targetCellOccupants'
  | 'crossAreaOccupants'
  /** Unidades atingidas por operações anteriores desta mesma ação e ainda vivas. */
  | 'survivingUnitsHit';

export type CellSelector = 'targetCell' | 'crossArea' | 'selfCell';

export const ENTITY_SELECTORS: readonly EntitySelector[] = [
  'self', 'targetCellOccupants', 'crossAreaOccupants', 'survivingUnitsHit',
];
export const CELL_SELECTORS: readonly CellSelector[] = ['targetCell', 'crossArea', 'selfCell'];

export type Stimulus = 'heat' | 'cold' | 'water';
export type ResourceKind = 'hp' | 'ap' | 'mp' | 'focus';

export type ObjectStateKind = 'normal' | 'open' | 'closed' | 'destroyed' | 'used';

export type EffectOp =
  /** `amount`: valor fixo ou fórmula de dados (ex.: `2d6+10`). */
  | { op: 'damage'; selector: EntitySelector; amount: DiceExpr; damageType: DamageType; ignoreArmor?: boolean }
  | { op: 'heal'; selector: EntitySelector; amount: DiceExpr }
  | { op: 'applyStatus'; selector: EntitySelector; statusId: string }
  | { op: 'removeStatus'; selector: EntitySelector; statusId: string; reason?: string }
  /** `ownTurns`: a barreira expira no início do N-ésimo turno próprio seguinte do alvo. */
  | { op: 'grantShield'; selector: EntitySelector; amount: number; ownTurns: number }
  | { op: 'restoreResource'; selector: EntitySelector; resource: ResourceKind; amount: DiceExpr }
  | { op: 'forceMove'; selector: EntitySelector; distance: number; direction: 'awayFromSource' }
  /** Desloca o executor até uma célula adjacente ao alvo (Investida), sem gastar PM. */
  | { op: 'dashToTarget'; maxCost: number }
  | { op: 'createSurface'; selector: CellSelector; surface: SurfaceKind; durationRounds: number | null }
  | { op: 'removeSurface'; selector: CellSelector; surface?: SurfaceKind }
  | { op: 'emitStimulus'; selector: CellSelector; stimulus: Stimulus }
  | { op: 'changeObjectState'; selector: EntitySelector; state: ObjectStateKind };

export type EffectOpName = EffectOp['op'];

export const EFFECT_OP_NAMES: readonly EffectOpName[] = [
  'damage', 'heal', 'applyStatus', 'removeStatus', 'grantShield', 'restoreResource',
  'forceMove', 'dashToTarget', 'createSurface', 'removeSurface', 'emitStimulus', 'changeObjectState',
];

// ---------------------------------------------------------------------------
// Alvos
// ---------------------------------------------------------------------------

export interface TargetingRule {
  kind: 'self' | 'cell' | 'unit';
  minRange?: number;
  range?: number;
  requiresLineOfSight?: boolean;
  sameFloor?: boolean;
}

export interface Cost {
  ap: number;
  focus?: number;
}

// ---------------------------------------------------------------------------
// Habilidades (seção 4)
// ---------------------------------------------------------------------------

export interface AbilityDefinition extends DefinitionBase {
  kind: 'ability';
  classId: string;
  cost: Cost;
  maxUsesPerTurn: number;
  /** Turnos próprios seguintes em que a habilidade permanece bloqueada. */
  blockedOwnTurnsAfterUse: number;
  target: TargetingRule;
  /** Exige arma equipada com esta tag (ex.: `bow`). */
  requiresWeaponTag?: string;
  /** Condição especial de ativação (ex.: Ocultação: fora da visão inimiga ou em área escura). */
  condition?: 'canHide';
  /** Exige jogada de ataque (d20 + bônus contra a Defesa) contra o personagem alvo. */
  attackRoll?: boolean;
  effects: EffectOp[];
  presentation?: Presentation;
}

// ---------------------------------------------------------------------------
// Itens (seção 3)
// ---------------------------------------------------------------------------

export interface WeaponDefinition extends DefinitionBase {
  kind: 'weapon';
  classIds: string[];
  cost: Cost;
  /** Fórmula de dano. Ataques com arma sempre exigem jogada de ataque. */
  damage: DiceExpr;
  damageType: DamageType;
  target: TargetingRule;
  presentation?: Presentation;
}

export interface ArmorDefinition extends DefinitionBase {
  kind: 'armor';
  classIds: string[];
  armor: number;
}

export interface AccessoryDefinition extends DefinitionBase {
  kind: 'accessory';
  maxHpBonus?: number;
  resistances?: Resistances;
}

export interface ConsumableDefinition extends DefinitionBase {
  kind: 'consumable';
  cost: Cost;
  target: TargetingRule;
  effects: EffectOp[];
  presentation?: Presentation;
}

export type ItemDefinition = WeaponDefinition | ArmorDefinition | AccessoryDefinition | ConsumableDefinition;

// ---------------------------------------------------------------------------
// Classes (seção 2.1)
// ---------------------------------------------------------------------------

export interface ClassDefinition extends DefinitionBase {
  kind: 'class';
  hp: number;
  ap: number;
  mp: number;
  maxFocus: number;
  /** Defesa: valor que a jogada de ataque inimiga precisa igualar ou superar. */
  defense: number;
  /** Bônus somado ao d20 nas jogadas de ataque. */
  attackBonus: number;
  loadout: {
    weapons: string[];
    armor: string;
    abilities: string[];
  };
}

// ---------------------------------------------------------------------------
// Estados (seção 5.1)
// ---------------------------------------------------------------------------

export type StatusDuration =
  /** Conta inícios de turno do alvo; decrementa a cada tick. */
  | { kind: 'targetTurnStarts'; count: number }
  /** Ativo durante os próximos N turnos do alvo; expira no fim do turno. */
  | { kind: 'targetTurns'; count: number }
  /** Sem expiração automática; removido por regras específicas. */
  | { kind: 'manual' };

export interface StatusDefinition extends DefinitionBase {
  kind: 'status';
  duration: StatusDuration;
  /** Dano no início do turno do alvo. */
  tickDamage?: { amount: number; damageType: DamageType };
  modifiers?: { mp?: number };
  flags?: Array<'rooted' | 'hidden'>;
  /** Reaplicar renova a duração, sem somar instâncias. */
  stacking: 'refresh';
  presentation?: Presentation;
}

// ---------------------------------------------------------------------------
// Superfícies (seção 5.2)
// ---------------------------------------------------------------------------

export interface SurfaceDefinition extends DefinitionBase {
  kind: 'surface';
  surface: SurfaceKind;
  /** Custo de PM para entrar na célula. */
  enterCost: number;
  /** Dano ao entrar, iniciar o turno ou ser criada sob o personagem. */
  exposureDamage?: { amount: number; damageType: DamageType };
}

// ---------------------------------------------------------------------------
// Objetos de mapa (seção 6.1)
// ---------------------------------------------------------------------------

export type ObjectInteraction =
  | { kind: 'toggleDoor' }
  | { kind: 'toggleLinked' }
  | { kind: 'grantConsumable'; itemId: string }
  | { kind: 'restoreFocus'; amount: DiceExpr }
  | { kind: 'emitWater' };

export interface MapObjectDefinition extends DefinitionBase {
  kind: 'object';
  /** `null` = indestrutível. */
  hp: number | null;
  material: 'wood' | 'stone' | 'metal' | 'water';
  initialState: ObjectStateKind;
  /** Estados nos quais o objeto bloqueia movimento. */
  blocksMovementIn: ObjectStateKind[];
  blocksVisionIn: ObjectStateKind[];
  flammable: boolean;
  /** Dano de fogo por início de rodada enquanto o objeto estiver em combustão. */
  combustionDamage?: number;
  explosion?: { damage: number; damageType: DamageType; radius: number };
  interaction?: ObjectInteraction;
  /** Usos por partida. Ausente = ilimitado. */
  maxUses?: number;
}

// ---------------------------------------------------------------------------
// Bonecos de teste (Combat Debug Lab)
// ---------------------------------------------------------------------------

export interface DummyPresetDefinition extends DefinitionBase {
  kind: 'dummy';
  hp: number;
  armor: number;
  defense: number;
  resistances: Resistances;
  immortal: boolean;
  canMove: boolean;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface Catalog {
  contentVersion: string;
  classes: Record<string, ClassDefinition>;
  abilities: Record<string, AbilityDefinition>;
  items: Record<string, ItemDefinition>;
  statuses: Record<string, StatusDefinition>;
  surfaces: Record<SurfaceKind, SurfaceDefinition>;
  objects: Record<string, MapObjectDefinition>;
  dummies: Record<string, DummyPresetDefinition>;
}
