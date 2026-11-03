import type { Coord, EntityId } from '../core/types.js';
import type { SurfaceKind } from '../map/grid.js';
import type { EffectOp } from '../rules/definitions.js';

export type CommandTarget =
  | { kind: 'self' }
  | { kind: 'cell'; x: number; y: number; floor: number }
  | { kind: 'entity'; id: EntityId };

interface CommandBase {
  /** Se informado, o comando só é aceito nesse turno (seção 11.1). */
  expectedTurnId?: number;
}

/** Intenções do jogador. O cliente nunca envia dano calculado. */
export type GameplayCommand =
  | (CommandBase & { type: 'START_MATCH' })
  | (CommandBase & { type: 'MOVE'; actorId: EntityId; to: Coord })
  | (CommandBase & { type: 'BASIC_ATTACK'; actorId: EntityId; weaponId: string; target: CommandTarget })
  | (CommandBase & { type: 'USE_ABILITY'; actorId: EntityId; abilityId: string; target: CommandTarget })
  | (CommandBase & { type: 'USE_ITEM'; actorId: EntityId; itemId: string; target?: CommandTarget })
  | (CommandBase & { type: 'DEFEND'; actorId: EntityId })
  | (CommandBase & { type: 'INTERACT'; actorId: EntityId; objectId: EntityId })
  | (CommandBase & { type: 'END_TURN'; actorId: EntityId })
  | (CommandBase & { type: 'SURRENDER'; actorId: EntityId });

/**
 * Comandos exclusivos do Combat Debug Lab. Nunca aceitos pelo servidor normal:
 * o motor só os executa com `options.allowDebugCommands`.
 */
export type DebugCommand =
  | { type: 'DEBUG_APPLY_EFFECTS'; sourceId?: EntityId; definitionId?: string; target: CommandTarget; effects: EffectOp[] }
  | { type: 'DEBUG_PAINT_SURFACE'; cells: Coord[]; surface: SurfaceKind | null; durationRounds?: number | null }
  | { type: 'DEBUG_SET_UNIT'; unitId: EntityId; patch: Partial<Record<'hp' | 'maxHp' | 'ap' | 'mp' | 'focus' | 'armor', number>> }
  | { type: 'DEBUG_RESET_DUMMY'; unitId: EntityId }
  /** Remove um personagem ou objeto do cenário (registrado na timeline). */
  | { type: 'DEBUG_REMOVE_ENTITY'; entityId: EntityId };

export type Command = GameplayCommand | DebugCommand;

export interface ExecutionOptions {
  /** Ignora PA/Foco (debug). */
  ignoreCost?: boolean;
  /** Ignora recarga e limite de usos por turno (debug). */
  ignoreCooldown?: boolean;
  /** Permite agir fora do próprio turno (debug). */
  ignoreTurn?: boolean;
  allowDebugCommands?: boolean;
}

/** "Forçar execução" do Debug Lab. Nunca utilizado pelo servidor normal. */
export const FORCE_EXECUTION: ExecutionOptions = {
  ignoreCost: true,
  ignoreCooldown: true,
  ignoreTurn: true,
  allowDebugCommands: true,
};

export type CommandErrorCode =
  | 'MATCH_NOT_ACTIVE'
  | 'MATCH_ALREADY_STARTED'
  | 'WRONG_TURN'
  | 'STALE_TURN'
  | 'UNKNOWN_ACTOR'
  | 'ACTOR_DEFEATED'
  | 'UNKNOWN_DEFINITION'
  | 'NOT_EQUIPPED'
  | 'NOT_ENOUGH_AP'
  | 'NOT_ENOUGH_FOCUS'
  | 'NOT_ENOUGH_MP'
  | 'ON_COOLDOWN'
  | 'MAX_USES_REACHED'
  | 'INVALID_TARGET'
  | 'OUT_OF_RANGE'
  | 'TOO_CLOSE'
  | 'DIFFERENT_FLOOR'
  | 'NO_LINE_OF_SIGHT'
  | 'NO_PATH'
  | 'ROOTED'
  | 'CANNOT_MOVE'
  | 'NOT_ADJACENT'
  | 'NOT_INTERACTABLE'
  | 'NO_USES_LEFT'
  | 'INVENTORY_FULL'
  | 'CELL_OCCUPIED'
  | 'MISSING_WEAPON'
  | 'NO_VALID_TARGET'
  | 'HIDE_NOT_ALLOWED'
  | 'TARGET_NOT_VISIBLE'
  | 'DEBUG_DISABLED';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}
