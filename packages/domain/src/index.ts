/**
 * @bardurinho/domain — núcleo de regras do jogo.
 * Não importa Babylon.js, Colyseus, PostgreSQL nem DOM (seção 9).
 */
export * from './core/types.js';
export * from './core/coords.js';
export * from './core/dice.js';
export * from './map/grid.js';
export * from './map/lineOfSight.js';
export * from './map/pathfinding.js';
export * from './rules/definitions.js';
export * from './state/types.js';
export * from './state/events.js';
export * from './state/context.js';
export * from './state/queries.js';
export * from './state/factory.js';
export * from './combat/damage.js';
export * from './combat/rolls.js';
export * from './effects/ops.js';
export * from './effects/statuses.js';
export * from './effects/surfaces.js';
export * from './effects/reactions.js';
export * from './effects/movement.js';
export * from './effects/dash.js';
export * from './turns/turns.js';
export * from './commands/types.js';
export * from './commands/engine.js';
export * from './scenario/scenario.js';
export * from './commands/checks.js';
export * from './commands/availability.js';
export * from './visibility/visibility.js';
export * from './visibility/projection.js';
export * from './match/summary.js';
