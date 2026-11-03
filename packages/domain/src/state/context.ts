import type { Catalog } from '../rules/definitions.js';
import type { EventCause, GameEvent, GameEventType } from './events.js';
import type { GameState } from './types.js';

/**
 * Contexto de resolução. Opera sobre um *estado candidato* (cópia), que só se torna
 * oficial se o comando terminar sem erro (seção 11.2, etapas 8–11).
 */
export interface ResolutionContext {
  state: GameState;
  catalog: Catalog;
  events: GameEvent[];
  cause: EventCause;
}

export function createContext(state: GameState, catalog: Catalog, cause?: Partial<EventCause>): ResolutionContext {
  return {
    state,
    catalog,
    events: [],
    cause: { commandSeq: null, sourceId: null, definitionId: null, ...cause },
  };
}

export function emit(ctx: ResolutionContext, type: GameEventType, payload: Record<string, unknown> = {}): GameEvent {
  const event: GameEvent = {
    seq: ctx.state.nextEventSeq++,
    type,
    round: ctx.state.turn.round,
    turnId: ctx.state.turn.turnId,
    cause: { ...ctx.cause },
    payload,
  };
  ctx.events.push(event);
  return event;
}

/** Executa `fn` com uma causa temporária (ex.: dano de uma reação causada por uma magia). */
export function withCause<T>(ctx: ResolutionContext, cause: Partial<EventCause>, fn: () => T): T {
  const previous = ctx.cause;
  ctx.cause = { ...previous, ...cause };
  try {
    return fn();
  } finally {
    ctx.cause = previous;
  }
}
