/**
 * Fase 5 — bots (seção 13): sempre comandos válidos (na visão da equipe e, salvo informação
 * oculta, no estado oficial), partidas até o fim, uso do ambiente, nada de posições ocultas e
 * simulação em lote em que o difícil vence o fácil na maioria das partidas.
 */
import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTIES, BotBrain, runBotMatch, type BotDifficulty } from '@bardurinho/ai';
import { DEFAULT_CONSUMABLES, catalog, patioDasRuinas } from '@bardurinho/content';
import { buildScenario, projectStateForClient, type GameplayCommand } from '@bardurinho/domain';
import { openMap } from './helpers.js';

const CLASSES = ['warrior', 'mage', 'rogue', 'druid'];
const ch = (classId: string) => ({ classId, consumables: [...DEFAULT_CONSUMABLES] });
const PLAYER_COMMANDS = new Set(['MOVE', 'BASIC_ATTACK', 'USE_ABILITY', 'USE_ITEM', 'DEFEND', 'INTERACT', 'END_TURN', 'SURRENDER']);

describe('bots: comandos válidos e partidas até o fim', () => {
  for (const difficulty of BOT_DIFFICULTIES) {
    it(`${difficulty}: todo comando é de jogador, válido na visão da equipe, e a partida termina`, () => {
      let total = 0;
      let invalidInView = 0;
      let rejected = 0;
      for (let i = 0; i < 4; i++) {
        const r = runBotMatch({
          catalog,
          map: patioDasRuinas,
          seed: 300 + i,
          A: { difficulty, character: ch(CLASSES[i]!) },
          B: { difficulty, character: ch(CLASSES[(i + 1) % 4]!) },
          onCommand: ({ command, validInView, accepted }) => {
            total++;
            expect(PLAYER_COMMANDS.has(command.type)).toBe(true);
            expect('expectedTurnId' in command).toBe(true);
            if (!validInView) invalidInView++;
            if (!accepted) rejected++;
          },
        });
        expect(r.finalState.status).toBe('finished');
        expect(r.rounds).toBeLessThanOrEqual(20);
      }
      expect(invalidInView).toBe(0);
      // Recusas oficiais só por informação oculta (inimigo invisível no caminho/na célula).
      expect(rejected / total).toBeLessThan(0.03);
    }, 60_000);
  }
});

describe('bots: decisão', () => {
  it('normal e difícil usam o ambiente: atacam o barril ao lado do inimigo (explosão garantida) em vez do inimigo', () => {
    const state = buildScenario(catalog, {
      map: { floors: [openMap(8, 8)] },
      units: [
        { id: 'mage-01', classId: 'mage', team: 'A', pos: { x: 2, y: 3 } },
        { id: 'warrior-01', classId: 'warrior', team: 'B', pos: { x: 5, y: 6 } },
      ],
      objects: [{ id: 'barrel-01', defId: 'barrel', pos: { x: 5, y: 5 } }],
      order: ['mage-01', 'warrior-01'],
    });
    for (const difficulty of ['normal', 'hard'] as BotDifficulty[]) {
      const bot = new BotBrain(catalog, 'A', { difficulty, seed: 1 });
      const d = bot.decide(projectStateForClient(state, catalog, 'A').state);
      // Varinha (sem Foco) ou Chama no barril: a explosão (20 de fogo) atinge o Guerreiro sem jogada de ataque.
      expect(['BASIC_ATTACK', 'USE_ABILITY']).toContain(d.command.type);
      expect((d.command as { target?: unknown }).target).toMatchObject({ kind: 'cell', x: 5, y: 5 });
      // Avaliação explicável (painel "AI"): opções ordenadas pela nota.
      expect(d.considered.length).toBeGreaterThan(3);
      expect(d.considered[0]!.score).toBeGreaterThanOrEqual(d.considered[1]!.score);
    }
  });

  it('não conhece posições ocultas: mesma visão → mesma decisão, onde quer que o inimigo oculto esteja', () => {
    const mk = (x: number, y: number) =>
      buildScenario(catalog, {
        map: { floors: [openMap(16, 16)] },
        units: [
          { id: 'warrior-01', classId: 'warrior', team: 'A', pos: { x: 1, y: 1 } },
          { id: 'mage-01', classId: 'mage', team: 'B', pos: { x, y } },
        ],
        order: ['warrior-01', 'mage-01'],
      });
    const decisions: GameplayCommand[] = [];
    for (const [x, y] of [[14, 14], [12, 15], [15, 10]] as const) {
      const view = projectStateForClient(mk(x, y), catalog, 'A').state;
      expect(view.units['mage-01']).toBeUndefined();
      decisions.push(new BotBrain(catalog, 'A', { difficulty: 'hard', seed: 5, explore: [{ x: 8, y: 8, floor: 0 }] }).decide(view).command);
    }
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[2]).toEqual(decisions[0]);
  });

  it('o bot só joga na vez da própria equipe', () => {
    const state = buildScenario(catalog, {
      map: { floors: [openMap()] },
      units: [
        { id: 'w', classId: 'warrior', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'm', classId: 'mage', team: 'B', pos: { x: 6, y: 6 } },
      ],
      order: ['w', 'm'],
    });
    expect(() => new BotBrain(catalog, 'B', { difficulty: 'easy' }).decide(state)).toThrow(/vez/);
  });
});

describe('bots: simulação em lote (difícil × fácil)', () => {
  it('o difícil vence o fácil na maioria das partidas (lados e classes alternados)', () => {
    const N = 10;
    let hard = 0;
    let easy = 0;
    for (let i = 0; i < N; i++) {
      const swap = i % 2 === 1;
      const ca = CLASSES[i % 4]!;
      const cb = CLASSES[(i + 1 + Math.floor(i / 4)) % 4]!;
      const r = runBotMatch({
        catalog,
        map: patioDasRuinas,
        seed: 1000 + i,
        A: { difficulty: swap ? 'easy' : 'hard', character: ch(ca) },
        B: { difficulty: swap ? 'hard' : 'easy', character: ch(cb) },
      });
      if (r.result?.kind === 'victory') {
        const hardTeam = swap ? 'B' : 'A';
        if (r.result.winnerTeam === hardTeam) hard++;
        else easy++;
      }
    }
    expect(hard).toBeGreaterThanOrEqual(7);
    expect(hard).toBeGreaterThan(easy * 2);
  }, 120_000);
});
