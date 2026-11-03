import type { EntityId } from '../core/types.js';

export type GameEventType =
  | 'MATCH_STARTED'
  | 'MATCH_ENDED'
  | 'ROUND_STARTED'
  | 'TURN_STARTED'
  | 'TURN_ENDED'
  | 'COMMAND_ACCEPTED'
  | 'RESOURCE_SPENT'
  | 'RESOURCE_RESTORED'
  | 'COOLDOWN_STARTED'
  | 'ATTACK_PERFORMED'
  | 'ABILITY_USED'
  | 'ITEM_USED'
  | 'DAMAGE_APPLIED'
  | 'HEALED'
  | 'SHIELD_GRANTED'
  | 'SHIELD_EXPIRED'
  | 'STATUS_APPLIED'
  | 'STATUS_REFRESHED'
  | 'STATUS_TICK'
  | 'STATUS_REMOVED'
  | 'STATUS_EXPIRED'
  | 'UNIT_MOVED'
  | 'FORCED_MOVE'
  | 'MOVE_BLOCKED'
  | 'UNIT_DEFEATED'
  | 'SURFACE_CREATED'
  | 'SURFACE_REMOVED'
  | 'SURFACE_EXPIRED'
  | 'SURFACE_EXPOSURE'
  | 'STIMULUS_EMITTED'
  | 'REACTION_TRIGGERED'
  | 'OBJECT_DAMAGED'
  | 'OBJECT_STATE_CHANGED'
  | 'OBJECT_DESTROYED'
  | 'OBJECT_IGNITED'
  | 'OBJECT_EXTINGUISHED'
  | 'EXPLOSION'
  | 'CONSUMABLE_GRANTED'
  | 'ENTITY_REMOVED'
  | 'EFFECT_IGNORED';

/** De onde veio o evento: qual comando, qual entidade e qual definição de conteúdo. */
export interface EventCause {
  commandSeq: number | null;
  sourceId: EntityId | null;
  definitionId: string | null;
}

export interface GameEvent {
  seq: number;
  type: GameEventType;
  round: number;
  turnId: number;
  cause: EventCause;
  payload: Record<string, unknown>;
}
