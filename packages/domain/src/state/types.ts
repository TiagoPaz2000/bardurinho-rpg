import type { Coord, EntityId, Resistances } from '../core/types.js';
import type { GameMap } from '../map/grid.js';
import type { ObjectStateKind } from '../rules/definitions.js';

/** Camada "Instância ativa" (seção 8.1). */
export interface StatusInstance {
  statusId: string;
  sourceId: EntityId | null;
  sourceDefinitionId: string | null;
  /** Contagem restante conforme `StatusDuration`. */
  remaining: number;
  /** Aplicado fora do turno do alvo e ainda não ativado por um início de turno. */
  pendingStart: boolean;
}

export interface Shield {
  amount: number;
  /** A barreira expira quando `ownTurnsStarted` do portador atinge este valor. */
  expiresAtOwnTurn: number;
  sourceId: EntityId | null;
  sourceDefinitionId: string | null;
}

export interface UnitFlags {
  immortal?: boolean;
  canMove?: boolean;
  isDummy?: boolean;
  // --- Opções do Test Dummy (Combat Debug Lab) ---
  /** Volta ao PV máximo após cada comando. */
  regenerate?: boolean;
  /** Remove todos os estados após cada comando. */
  clearStatusesAfterCommand?: boolean;
  /** Remove a barreira após cada comando. */
  clearShieldAfterCommand?: boolean;
  /** Ignora deslocamentos forçados (Empurrão). */
  immuneForcedMove?: boolean;
  /** Ignora a aplicação de estados. */
  immuneStatuses?: boolean;
  /** Ignora dano de superfícies (fogo, espinhos). */
  immuneSurfaces?: boolean;
}

export interface Unit {
  id: EntityId;
  entity: 'unit';
  name: string;
  classId: string | null;
  dummyPresetId: string | null;
  team: string;
  pos: Coord;
  alive: boolean;

  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
  focus: number;
  maxFocus: number;
  armor: number;
  resistances: Resistances;
  shield: Shield | null;

  weapons: string[];
  armorId: string | null;
  accessoryId: string | null;
  abilities: string[];
  /** Consumíveis temporários da partida (máx. 2, sem repetir tipo). */
  consumables: string[];

  statuses: StatusInstance[];
  /** Contador de turnos próprios iniciados. */
  ownTurnsStarted: number;
  /** abilityId -> valor de `ownTurnsStarted` a partir do qual volta a ficar disponível. */
  availableFromOwnTurn: Record<string, number>;
  usesThisTurn: Record<string, number>;
  defendedThisTurn: boolean;
  flags: UnitFlags;
}

export interface MapObject {
  id: EntityId;
  entity: 'object';
  defId: string;
  pos: Coord;
  hp: number | null;
  maxHp: number | null;
  state: ObjectStateKind;
  burning: boolean;
  usesLeft: number | null;
  /** Objeto controlado (ex.: alavanca -> portão). */
  linkedId: EntityId | null;
}

export type Entity = Unit | MapObject;

export interface TurnState {
  round: number;
  /** Identificador incremental do turno (usado em `expectedTurnId`). */
  turnId: number;
  order: EntityId[];
  activeIndex: number;
  activeUnitId: EntityId | null;
}

export type MatchResult =
  | { kind: 'victory'; winnerTeam: string; reason: 'elimination' | 'surrender' }
  | { kind: 'draw'; reason: 'mutualDestruction' | 'roundLimit' };

export interface GameState {
  rulesVersion: number;
  contentVersion: string;
  map: GameMap;
  units: Record<EntityId, Unit>;
  objects: Record<EntityId, MapObject>;
  turn: TurnState;
  status: 'setup' | 'active' | 'finished';
  result: MatchResult | null;
  maxRounds: number;
  /** unitId -> categorias de superfície que já causaram dano neste turno global. */
  surfaceHitsThisTurn: Record<EntityId, string[]>;
  nextEventSeq: number;
  nextCommandSeq: number;
}
