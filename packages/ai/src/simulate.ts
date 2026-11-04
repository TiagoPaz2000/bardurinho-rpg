/**
 * Partida bot × bot sem servidor (testes e simulação em lote): estado oficial com dados
 * aleatórios; cada bot decide só com a visão da sua equipe (`projectStateForClient`) e o
 * comando passa pelo `applyCommand` oficial, como no servidor.
 */
import { buildScenario, projectStateForClient, applyCommand, type Catalog, type GameplayCommand, type GameState, type MatchResult } from '@bardurinho/domain';
import { scenarioFromSetup, type CharacterChoice, type MapDefinition } from '@bardurinho/content';
import { BotBrain, type BotDifficulty } from './bot.js';

export interface BotMatchOptions {
  catalog: Catalog;
  map: MapDefinition;
  seed: number;
  A: { difficulty: BotDifficulty; character: CharacterChoice };
  B: { difficulty: BotDifficulty; character: CharacterChoice };
  /** Limite de comandos (segurança). */
  maxCommands?: number;
  /** Chamado a cada comando (testes de validade). */
  onCommand?: (info: { team: string; command: GameplayCommand; view: GameState; validInView: boolean; accepted: boolean; error?: string }) => void;
}

export interface BotMatchReport {
  result: MatchResult | null;
  rounds: number;
  commands: number;
  rejected: number;
  finalState: GameState;
}

/** Pontos de início do adversário (exploração quando ninguém está à vista). */
export function exploreTargets(map: MapDefinition, team: string) {
  const other = team === 'A' ? 'B' : 'A';
  return map.spawns[other].map((p) => ({ x: p.x, y: p.y, floor: p.floor ?? 0 }));
}

export function runBotMatch(o: BotMatchOptions): BotMatchReport {
  const { catalog } = o;
  let state = buildScenario(catalog, { ...scenarioFromSetup(o.map, catalog, { teams: { A: [o.A.character], B: [o.B.character] } }), dice: 'random', seed: o.seed, autoStart: true, initiative: 'roll' });
  const bots: Record<string, BotBrain> = {
    A: new BotBrain(catalog, 'A', { difficulty: o.A.difficulty, seed: o.seed * 7 + 1, explore: exploreTargets(o.map, 'A') }),
    B: new BotBrain(catalog, 'B', { difficulty: o.B.difficulty, seed: o.seed * 13 + 5, explore: exploreTargets(o.map, 'B') }),
  };
  let commands = 0;
  let rejected = 0;
  const max = o.maxCommands ?? 1500;
  while (state.status === 'active' && commands < max) {
    const active = state.units[state.turn.activeUnitId!]!;
    const bot = bots[active.team]!;
    const view = projectStateForClient(state, catalog, active.team).state;
    const decision = bot.decide(view);
    const validInView = applyCommand(view, catalog, decision.command).ok;
    const r = applyCommand(state, catalog, decision.command);
    commands++;
    o.onCommand?.({ team: active.team, command: decision.command, view, validInView, accepted: r.ok, ...(r.ok ? {} : { error: r.error.code }) });
    if (r.ok) state = r.state;
    else {
      rejected++;
      bot.rejectedCommand(decision.command);
      // Recusa repetida: encerra o turno (o servidor faria o mesmo pelo cronômetro).
      if (decision.command.type === 'END_TURN') break;
    }
  }
  return { result: state.result, rounds: state.turn.round, commands, rejected, finalState: state };
}
