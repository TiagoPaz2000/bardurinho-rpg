import { describe, expect, it } from 'vitest';
import { applyCommand, buildScenario, type ScenarioInitial } from '@bardurinho/domain';
import { catalog, entity, run } from './helpers.js';

const charge = { type: 'USE_ABILITY', actorId: 'war', abilityId: 'warrior.charge', target: entity('mage') } as const;

const lane = (extra: Partial<ScenarioInitial> = {}, mageX = 4, warriorHp?: number) =>
  buildScenario(catalog, {
    map: { floors: [['........']] },
    units: [
      { id: 'war', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 }, ...(warriorHp ? { hp: warriorHp } : {}) },
      { id: 'mage', classId: 'mage', team: 'B', pos: { x: mageX, y: 0 } },
    ],
    ...extra,
  });

describe('Investida (guerreiro)', () => {
  it('desloca até a célula adjacente e causa 16 físico, sem gastar PM', () => {
    const { state, events } = run(lane(), charge);
    expect(state.units.war!.pos).toEqual({ x: 3, y: 0, floor: 0 });
    expect(state.units.mage!.hp).toBe(80 - 16);
    expect(state.units.war).toMatchObject({ mp: 5, ap: 1, focus: 6 });
    expect(events.filter((e) => e.type === 'UNIT_MOVED' && e.payload.dash)).toHaveLength(3);
  });

  it('já adjacente: ataca sem se mover', () => {
    const { state } = run(lane({}, 1), charge);
    expect(state.units.war!.pos).toEqual({ x: 0, y: 0, floor: 0 });
    expect(state.units.mage!.hp).toBe(64);
  });

  it('percurso limitado a 4 PM, contando o custo do terreno', () => {
    const r = applyCommand(lane({ surfaces: [{ cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], surface: 'oil' }] }), catalog, charge);
    expect(r.ok ? null : r.error.code).toBe('NO_PATH');
    // Rejeitado antes de gastar recursos.
    expect(r.state.units.war).toMatchObject({ ap: 2, focus: 8 });
  });

  it('não atravessa porta fechada', () => {
    // A porta bloqueia a visão do guerreiro; um aliado do outro lado enxerga o mago.
    const state = buildScenario(catalog, {
      map: { floors: [['########', '........', '########']] },
      units: [
        { id: 'war', classId: 'warrior', team: 'A', pos: { x: 0, y: 1 } },
        { id: 'mage', classId: 'mage', team: 'B', pos: { x: 4, y: 1 } },
        { id: 'ally', classId: 'rogue', team: 'A', pos: { x: 7, y: 1 } },
      ],
      objects: [{ id: 'door', defId: 'door', pos: { x: 2, y: 1 } }],
    });
    const r = applyCommand(state, catalog, charge);
    expect(r.ok ? null : r.error.code).toBe('NO_PATH');
  });

  it('pode morrer no fogo antes de concluir o ataque', () => {
    const state0 = lane({ surfaces: [{ cells: [{ x: 1, y: 0 }], surface: 'fire', durationRounds: 3 }] }, 4, 5);
    const { state, events } = run(state0, charge);
    expect(state.units.war!.alive).toBe(false);
    expect(state.units.mage!.hp).toBe(80);
    expect(events.some((e) => e.type === 'DAMAGE_APPLIED' && e.payload.targetId === 'mage')).toBe(false);
    expect(state.result).toEqual({ kind: 'victory', winnerTeam: 'B', reason: 'elimination' });
  });

  it('enraizado só pode investir se já estiver adjacente', () => {
    const rooted = lane();
    rooted.units.war!.statuses.push({ statusId: 'rooted', sourceId: null, sourceDefinitionId: null, remaining: 1, pendingStart: false });
    const r = applyCommand(rooted, catalog, charge);
    expect(r.ok ? null : r.error.code).toBe('ROOTED');
  });
});
