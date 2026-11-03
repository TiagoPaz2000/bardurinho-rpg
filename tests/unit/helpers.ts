import { catalog } from '@bardurinho/content';
import {
  applyCommand,
  buildScenario,
  type Command,
  type ExecutionOptions,
  type GameEvent,
  type GameState,
  type ScenarioInitial,
} from '@bardurinho/domain';

export { catalog };

export const openMap = (w = 8, h = 8): string[] => Array.from({ length: h }, () => '.'.repeat(w));

export function scenario(partial: Omit<ScenarioInitial, 'map'> & { map?: ScenarioInitial['map'] }): GameState {
  return buildScenario(catalog, { map: { floors: [openMap()] }, ...partial });
}

/** Aplica um comando e falha o teste se for rejeitado. */
export function run(state: GameState, command: Command, options?: ExecutionOptions): { state: GameState; events: GameEvent[] } {
  const r = applyCommand(state, catalog, command, options);
  if (!r.ok) throw new Error(`${command.type} rejeitado: ${r.error.code} — ${r.error.message}`);
  return r;
}

export function runAll(state: GameState, commands: Command[], options?: ExecutionOptions): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (const c of commands) {
    const r = run(current, c, options);
    current = r.state;
    events.push(...r.events);
  }
  return { state: current, events };
}

export const endTurn = (actorId: string): Command => ({ type: 'END_TURN', actorId });
export const cell = (x: number, y: number, floor = 0) => ({ kind: 'cell' as const, x, y, floor });
export const entity = (id: string) => ({ kind: 'entity' as const, id });
