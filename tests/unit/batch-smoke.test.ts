/**
 * Fase 6: versão rápida do lote de invariantes (`npm run batch:invariants` roda milhares).
 * Algumas partidas bot × bot pelo core oficial, conferindo os invariantes a cada comando,
 * o fim dentro do limite de rodadas e o determinismo pela semente.
 */
import { describe, expect, it } from 'vitest';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { buildScenario } from '@bardurinho/domain';
import { checkState, playMatch, type MatchSpec } from '../../tools/batch/match.js';

const spec = (seed: number, a: string[], b: string[], da: MatchSpec['A']['difficulty'] = 'easy', db: MatchSpec['B']['difficulty'] = 'normal'): MatchSpec => ({
  seed,
  A: { difficulty: da, classes: a },
  B: { difficulty: db, classes: b },
  check: true,
});

const hashes = new Map<number, string>();

describe('lote de invariantes (amostra)', () => {
  it('1 × 1: as quatro classes terminam sem violar invariantes', () => {
    const pairs: Array<[string, string]> = [['warrior', 'mage'], ['rogue', 'druid']];
    pairs.forEach(([a, b], i) => {
      const r = playMatch(spec(700 + i, [a], [b], 'easy', 'easy'), catalog, patioDasRuinas);
      hashes.set(700 + i, r.hash);
      expect(r.violations).toEqual([]);
      expect(['A', 'B', 'draw']).toContain(r.winner);
      expect(r.rounds).toBeLessThanOrEqual(20);
    });
  }, 20000);

  it('2 × 2 termina sem violar invariantes', () => {
    const r = playMatch(spec(811, ['warrior', 'druid'], ['rogue', 'mage'], 'easy', 'easy'), catalog, patioDasRuinas);
    expect(r.violations).toEqual([]);
    expect(r.winner).not.toBe('none');
  }, 20000);

  it('mesma semente → mesmo estado final (hash)', () => {
    const again = playMatch(spec(700, ['warrior'], ['mage'], 'easy', 'easy'), catalog, patioDasRuinas);
    expect(hashes.get(700)).toBeDefined();
    expect(again.hash).toBe(hashes.get(700));
  }, 20000);

  it('o verificador acusa estados inválidos', () => {
    const s = buildScenario(catalog, { ...patioDasRuinas.scenario, dice: 'average', autoStart: false });
    const [u1, u2] = Object.values(s.units);
    u1!.hp = u1!.maxHp + 1;
    u1!.focus = -1;
    u2!.pos = { ...u1!.pos };
    const problems = checkState(s, catalog).join('\n');
    expect(problems).toMatch(/PV .* > máximo/);
    expect(problems).toMatch(/focus inválido/);
    expect(problems).toMatch(/mesma célula/);
  });
});
