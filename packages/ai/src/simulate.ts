/**
 * Partida bot × bot sem servidor (testes e simulação em lote): estado oficial com dados
 * aleatórios; cada bot decide só com a visão da sua equipe (`projectStateForClient`) e o
 * comando passa pelo `applyCommand` oficial, como no servidor.
 *
 * Fase 6: equipes com 1 ou 2 personagens (`characters`), eventos aceitos (`onStep`, com o
 * estado antes/depois — usado pelo lote de invariantes e pelo balanceamento).
 */
import { buildScenario, projectStateForClient, applyCommand, type Catalog, type GameEvent, type GameplayCommand, type GameState, type MatchResult } from '@bardurinho/domain';
import { scenarioFromSetup, type CharacterChoice, type MapDefinition } from '@bardurinho/content';
import { BotBrain, type BotDifficulty } from './bot.js';

export interface BotTeamOptions {
  difficulty: BotDifficulty;
  /** Personagem (1 × 1). */
  character?: CharacterChoice;
  /** Fase 6: personagens da equipe (1 ou 2); tem prioridade sobre `character`. */
  characters?: CharacterChoice[];
}

export interface BotMatchOptions {
  catalog: Catalog;
  map: MapDefinition;
  seed: number;
  A: BotTeamOptions;
  B: BotTeamOptions;
  /** Limite de comandos (segurança). */
  maxCommands?: number;
  /** Chamado a cada comando (testes de validade). */
  onCommand?: (info: { team: string; command: GameplayCommand; view: GameState; validInView: boolean; accepted: boolean; error?: string }) => void;
  /** Fase 6: chamado a cada comando aceito (estado antes/depois e eventos oficiais). */
  onStep?: (info: { team: string; command: GameplayCommand; before: GameState; after: GameState; events: readonly GameEvent[] }) => void;
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

const teamChars = (t: BotTeamOptions): CharacterChoice[] => t.characters ?? (t.character ? [t.character] : []);

/** Estado inicial (iniciativa rolada) de uma partida bot × bot. */
export function initialBotMatchState(o: Pick<BotMatchOptions, 'catalog' | 'map' | 'seed' | 'A' | 'B'>): GameState {
  return buildScenario(o.catalog, { ...scenarioFromSetup(o.map, o.catalog, { teams: { A: teamChars(o.A), B: teamChars(o.B) } }), dice: 'random', seed: o.seed, autoStart: true, initiative: 'roll' });
}

export function runBotMatch(o: BotMatchOptions): BotMatchReport {
  const { catalog } = o;
  let state = initialBotMatchState(o);
  const bots: Record<string, BotBrain> = {
    A: new BotBrain(catalog, 'A', { difficulty: o.A.difficulty, seed: o.seed * 7 + 1, explore: exploreTargets(o.map, 'A') }),
    B: new BotBrain(catalog, 'B', { difficulty: o.B.difficulty, seed: o.seed * 13 + 5, explore: exploreTargets(o.map, 'B') }),
  };
  let commands = 0;
  let rejected = 0;
  const max = o.maxCommands ?? 1500 * Math.max(teamChars(o.A).length, teamChars(o.B).length, 1);
  while (state.status === 'active' && commands < max) {
    const active = state.units[state.turn.activeUnitId!]!;
    const bot = bots[active.team]!;
    const view = projectStateForClient(state, catalog, active.team).state;
    const decision = bot.decide(view);
    const validInView = o.onCommand ? applyCommand(view, catalog, decision.command).ok : true;
    const r = applyCommand(state, catalog, decision.command);
    commands++;
    o.onCommand?.({ team: active.team, command: decision.command, view, validInView, accepted: r.ok, ...(r.ok ? {} : { error: r.error.code }) });
    if (r.ok) {
      o.onStep?.({ team: active.team, command: decision.command, before: state, after: r.state, events: r.events });
      state = r.state;
    } else {
      rejected++;
      bot.rejectedCommand(decision.command);
      // Recusa repetida: encerra o turno (o servidor faria o mesmo pelo cronômetro).
      if (decision.command.type === 'END_TURN') break;
    }
  }
  return { result: state.result, rounds: state.turn.round, commands, rejected, finalState: state };
}
