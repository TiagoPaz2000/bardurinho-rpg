import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyCommands,
  buildScenario,
  createRng,
  diceStats,
  formatDice,
  getCell,
  parseDice,
  rollDice,
  type Command,
  type GameState,
  type ScenarioInitial,
} from '@bardurinho/domain';
import { catalog, entity, openMap } from './helpers.js';

const duel = (extra: Partial<ScenarioInitial> = {}): GameState =>
  buildScenario(catalog, {
    map: { floors: [openMap()] },
    units: [
      { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
      { id: 'war', classId: 'warrior', team: 'B', pos: { x: 4, y: 1 } },
    ],
    ...extra,
  });
const force = (...forced: number[]): Command => ({ type: 'DEBUG_SET_RNG', forced });
const flame: Command = { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: entity('war') };
const debug = { allowDebugCommands: true };

describe('fórmulas de dados', () => {
  it('interpreta, formata e calcula faixa/média', () => {
    expect(parseDice('2d6+10')).toEqual({ terms: [{ count: 2, sides: 6 }], bonus: 10 });
    expect(formatDice('d20')).toBe('1d20');
    expect(diceStats('2d6+10')).toEqual({ min: 12, max: 22, average: 17 });
    expect(() => parseDice('1d7')).toThrow(/não suportado/);
  });

  it('mesma semente = mesmas rolagens; outra semente = outra sequência', () => {
    const seq = (seed: number) => Array.from({ length: 20 }, ((r) => () => rollDice(r, '1d20').total)(createRng(seed)));
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
    for (const v of seq(7)) expect(v).toBeGreaterThanOrEqual(1);
  });

  it('modo "média fixa": cada dado vale a média arredondada para cima', () => {
    expect(rollDice(createRng(1, 'average'), '2d6+10').total).toBe(18);
    expect(rollDice(createRng(1, 'average'), '1d20').total).toBe(11);
  });
});

describe('jogada de ataque (d20 + bônus contra Defesa)', () => {
  it('acerta quando d20 + bônus ≥ Defesa; erra abaixo', () => {
    // Mago tem +5; guerreiro tem Defesa 14.
    const miss = applyCommands(duel(), catalog, [force(8), flame], debug);
    expect(miss.state.units.war!.hp).toBe(110);
    expect(miss.events.find((e) => e.type === 'ATTACK_ROLLED')!.payload).toMatchObject({ natural: 8, total: 13, defense: 14, hit: false });
    const hit = applyCommands(duel(), catalog, [force(9, 1, 1), flame], debug);
    expect(hit.state.units.war!.hp).toBe(110 - (1 + 1 + 10));
  });

  it('1 natural erra sempre; 20 natural é crítico (dados de dano em dobro)', () => {
    const one = applyCommands(duel(), catalog, [force(1), flame], debug);
    expect(one.state.units.war!.statuses).toEqual([]);
    const crit = applyCommands(duel(), catalog, [force(20, 6, 6, 6, 6), flame], debug);
    expect(crit.state.units.war!.hp).toBe(110 - (24 + 10));
    const roll = crit.events.find((e) => e.type === 'DICE_ROLLED' && e.payload.purpose === 'damage')!;
    expect(roll.payload).toMatchObject({ critical: true, total: 34 });
  });

  it('errar o personagem não impede o efeito na célula (calor sobre óleo)', () => {
    const s = duel({ surfaces: [{ cells: [{ x: 4, y: 1 }], surface: 'oil' }] });
    const r = applyCommands(s, catalog, [force(1), flame], debug);
    expect(getCell(r.state.map, { x: 4, y: 1, floor: 0 })!.surface?.kind).toBe('fire');
  });

  it('objetos são atingidos automaticamente (sem jogada de ataque)', () => {
    const s = duel({ objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 3, y: 3 } }] });
    const r = applyCommand(s, catalog, { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: { kind: 'cell', x: 3, y: 3, floor: 0 } });
    expect(r.ok && r.events.some((e) => e.type === 'ATTACK_ROLLED')).toBe(false);
    expect(r.ok && r.state.objects.barrel!.state).toBe('destroyed');
  });

  it('em modo aleatório, a partida é reproduzível pela semente', () => {
    const run = () => applyCommands(duel({ dice: 'random', seed: 123 }), catalog, [flame], debug);
    expect(JSON.stringify(run().state)).toBe(JSON.stringify(run().state));
  });
});

describe('curas e iniciativa', () => {
  it('Poção de vida rola 4d6+8 (entre 12 e 32)', () => {
    const s = buildScenario(catalog, {
      map: { floors: [openMap()] },
      dice: 'random',
      seed: 9,
      units: [{ id: 'w', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 }, hp: 50, consumables: ['consumable.health_potion'] }],
    });
    const r = applyCommand(s, catalog, { type: 'USE_ITEM', actorId: 'w', itemId: 'consumable.health_potion' });
    if (!r.ok) throw new Error(r.error.message);
    const healed = r.state.units.w!.hp - 50;
    expect(healed).toBeGreaterThanOrEqual(12);
    expect(healed).toBeLessThanOrEqual(32);
    expect(r.events.some((e) => e.type === 'DICE_ROLLED' && e.payload.purpose === 'heal')).toBe(true);
  });

  it('iniciativa por d20 define a ordem (maior primeiro)', () => {
    const s = buildScenario(catalog, {
      map: { floors: [openMap()] },
      initiative: 'roll',
      autoStart: false,
      units: [
        { id: 'a', classId: 'mage', team: 'A', pos: { x: 0, y: 0 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 5, y: 5 } },
      ],
    });
    const r = applyCommands(s, catalog, [force(5, 17), { type: 'START_MATCH' }], debug);
    expect(r.state.turn.order).toEqual(['b', 'a']);
    expect(r.state.turn.activeUnitId).toBe('b');
    expect(r.events.find((e) => e.type === 'INITIATIVE_ROLLED')!.payload.rolls).toEqual([{ unitId: 'a', roll: 5 }, { unitId: 'b', roll: 17 }]);
  });
});
