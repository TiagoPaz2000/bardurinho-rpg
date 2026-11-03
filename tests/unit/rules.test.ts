import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  computeDamage,
  createMapFromAscii,
  distance,
  findPath,
  getCell,
  lineOfSight,
  buildScenario,
} from '@bardurinho/domain';
import { catalog, cell, endTurn, entity, openMap, run, runAll, scenario } from './helpers.js';

describe('dano e mitigação (seção 2.3)', () => {
  it('espada 18 contra armadura 4 e barreira 6 tira 8 PV', () => {
    const r = computeDamage(18, 4, 6, 100);
    expect(r).toMatchObject({ afterMitigation: 14, shieldAbsorbed: 6, hpDamage: 8, hpAfter: 92 });
  });

  it('mitigação nunca gera dano negativo', () => {
    expect(computeDamage(5, 10, 0, 50)).toMatchObject({ afterMitigation: 0, hpDamage: 0, mitigated: 5 });
  });
});

describe('distância, linha de visão e caminho', () => {
  it('distância = |dx| + |dy| + 2 × |dAndar|', () => {
    expect(distance({ x: 0, y: 0, floor: 0 }, { x: 3, y: 2, floor: 1 })).toBe(7);
  });

  it('parede bloqueia linha de visão', () => {
    const state = scenario({ map: { floors: [['.....', '..#..', '.....']] } });
    const los = lineOfSight(state, catalog, { x: 0, y: 1, floor: 0 }, { x: 4, y: 1, floor: 0 });
    expect(los).toMatchObject({ visible: false, reason: 'WALL_BLOCK', blockedAt: { x: 2, y: 1, floor: 0 } });
    expect(lineOfSight(state, catalog, { x: 0, y: 0, floor: 0 }, { x: 4, y: 0, floor: 0 }).visible).toBe(true);
  });

  it('óleo custa 2 PM e o caminho evita quando possível', () => {
    const state = scenario({
      map: { floors: [['...', '...']] },
      surfaces: [{ cells: [{ x: 1, y: 0 }], surface: 'oil' }],
    });
    const through = findPath(state, catalog, { x: 0, y: 0, floor: 0 }, { x: 1, y: 0, floor: 0 });
    expect(through?.cost).toBe(2);
    const around = findPath(state, catalog, { x: 0, y: 0, floor: 0 }, { x: 2, y: 0, floor: 0 });
    expect(around?.cost).toBe(3);
  });

  it('escada conecta andares com custo 2', () => {
    const map = createMapFromAscii([['...'], ['...']], [{ a: { x: 2, y: 0, floor: 0 }, b: { x: 2, y: 0, floor: 1 }, cost: 2 }]);
    const state = buildScenario(catalog, { map: { floors: [['...'], ['...']], connections: map.connections } });
    expect(findPath(state, catalog, { x: 0, y: 0, floor: 0 }, { x: 0, y: 0, floor: 1 })?.cost).toBe(6);
  });
});

describe('turnos, recursos e recargas', () => {
  const mageVsDummy = () =>
    scenario({
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 4, y: 1 } },
      ],
      order: ['mage', 'dummy'],
    });

  it('rejeita ação fora do turno', () => {
    const state = scenario({
      units: [
        { id: 'a', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 5, y: 5 } },
      ],
    });
    const r = applyCommand(state, catalog, { type: 'DEFEND', actorId: 'b' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('WRONG_TURN');
  });

  it('PA são restaurados e Foco recupera 2 por turno, até o máximo', () => {
    let { state } = runAll(mageVsDummy(), [
      { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: entity('dummy') },
      { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.frost_ray', target: entity('dummy') },
    ]);
    expect(state.units.mage).toMatchObject({ ap: 0, focus: 6 });
    ({ state } = run(state, endTurn('mage')));
    expect(state.turn.round).toBe(2);
    expect(state.units.mage).toMatchObject({ ap: 2, focus: 8 });
  });

  it('recarga 1: bloqueada no próximo turno próprio, livre no seguinte', () => {
    const frost = { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.frost_ray', target: entity('dummy') } as const;
    let { state } = runAll(mageVsDummy(), [frost, endTurn('mage')]);
    const blocked = applyCommand(state, catalog, frost);
    expect(blocked.ok ? null : blocked.error.code).toBe('ON_COOLDOWN');
    ({ state } = run(state, endTurn('mage')));
    expect(applyCommand(state, catalog, frost).ok).toBe(true);
  });

  it('recarga 0 ainda limita a uma utilização por turno', () => {
    const flame = { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: entity('dummy') } as const;
    const { state } = run(mageVsDummy(), flame);
    const again = applyCommand(state, catalog, flame);
    expect(again.ok ? null : again.error.code).toBe('MAX_USES_REACHED');
  });

  it('modo debug ignora custo e recarga', () => {
    const flame = { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: entity('dummy') } as const;
    const { state } = runAll(mageVsDummy(), [flame, flame, flame], { ignoreCost: true, ignoreCooldown: true });
    expect(state.units.mage!.focus).toBe(10);
    expect(state.units.dummy!.hp).toBe(100 - 18 * 3);
  });

  it('comandos de debug são recusados sem permissão explícita', () => {
    const r = applyCommand(mageVsDummy(), catalog, { type: 'DEBUG_PAINT_SURFACE', cells: [{ x: 0, y: 0, floor: 0 }], surface: 'fire' });
    expect(r.ok ? null : r.error.code).toBe('DEBUG_DISABLED');
  });
});

describe('estados (seção 5.1)', () => {
  const duel = (classA = 'mage', classB = 'warrior') =>
    scenario({
      units: [
        { id: 'a', classId: classA, team: 'A', pos: { x: 1, y: 1 } },
        { id: 'b', classId: classB, team: 'B', pos: { x: 4, y: 1 } },
      ],
    });

  it('Queimando: 4 de fogo em dois inícios de turno do alvo; reaplicar renova sem somar', () => {
    const flame = { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.flame', target: entity('b') } as const;
    let { state } = run(duel(), flame);
    expect(state.units.b!.hp).toBe(110 - 18);
    ({ state } = runAll(state, [endTurn('a')]));
    expect(state.units.b!.hp).toBe(110 - 18 - 4);
    ({ state } = runAll(state, [endTurn('b'), flame, endTurn('a')]));
    // Reaplicado: um único estado, renovado; tick no início do turno.
    expect(state.units.b!.statuses.filter((s) => s.statusId === 'burning')).toHaveLength(1);
    expect(state.units.b!.hp).toBe(110 - 18 - 4 - 18 - 4);
    ({ state } = runAll(state, [endTurn('b'), endTurn('a')]));
    expect(state.units.b!.hp).toBe(110 - 18 - 4 - 18 - 4 - 4);
    expect(state.units.b!.statuses).toHaveLength(0);
  });

  it('Lentidão: −2 PM apenas no próximo turno do alvo', () => {
    let { state } = runAll(duel(), [
      { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.frost_ray', target: entity('b') },
      endTurn('a'),
    ]);
    expect(state.units.b!.mp).toBe(3);
    ({ state } = runAll(state, [endTurn('b'), endTurn('a')]));
    expect(state.units.b!.mp).toBe(5);
    expect(state.units.b!.statuses).toHaveLength(0);
  });

  it('Frio apaga fogo na célula e remove Queimando', () => {
    const state0 = scenario({
      units: [
        { id: 'a', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 4, y: 1 } },
      ],
      surfaces: [{ cells: [{ x: 4, y: 1 }], surface: 'fire', durationRounds: 5 }],
    });
    const { state, events } = runAll(state0, [
      { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.flame', target: entity('b') },
      { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.frost_ray', target: entity('b') },
    ]);
    expect(state.units.b!.statuses.map((s) => s.statusId)).toEqual(['slowed']);
    expect(getCell(state.map, { x: 4, y: 1, floor: 0 })!.surface).toBeNull();
    expect(state.units.b!.hp).toBe(110 - 18 - 14);
    expect(events.some((e) => e.type === 'STATUS_REMOVED' && e.payload.reason === 'cold_effect')).toBe(true);
  });

  it('Empurrão: 6 físico e desloca duas células em linha reta', () => {
    const state0 = scenario({
      units: [
        { id: 'a', classId: 'warrior', team: 'A', pos: { x: 3, y: 3 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 4, y: 3 } },
      ],
    });
    const { state } = run(state0, { type: 'USE_ABILITY', actorId: 'a', abilityId: 'warrior.push', target: entity('b') });
    expect(state.units.b!.pos).toEqual({ x: 6, y: 3, floor: 0 });
    expect(state.units.b!.hp).toBe(110 - 2);
  });
});

describe('barreira (Defender e Barreira arcana)', () => {
  const solo = () =>
    scenario({
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 6, y: 6 } },
      ],
      order: ['mage', 'dummy'],
    });

  it('barreira mais fraca não substitui a mais forte; Barreira arcana dura até o 2º turno próprio seguinte', () => {
    let { state } = runAll(solo(), [
      { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.arcane_barrier', target: { kind: 'self' } },
      { type: 'DEFEND', actorId: 'mage' },
    ]);
    expect(state.units.mage!.shield?.amount).toBe(18);
    ({ state } = run(state, endTurn('mage')));
    expect(state.units.mage!.shield?.amount).toBe(18);
    ({ state } = run(state, endTurn('mage')));
    expect(state.units.mage!.shield).toBeNull();
  });

  it('Defender só pode ser usado uma vez por turno', () => {
    const { state } = run(solo(), { type: 'DEFEND', actorId: 'mage' });
    const again = applyCommand(state, catalog, { type: 'DEFEND', actorId: 'mage' });
    expect(again.ok ? null : again.error.code).toBe('MAX_USES_REACHED');
  });
});

describe('superfícies e reações (seções 5.2 e 5.3)', () => {
  it('dano de superfície ocorre no máximo uma vez por turno global', () => {
    const state0 = scenario({
      units: [
        { id: 'w', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 7, y: 7 } },
      ],
      order: ['w', 'dummy'],
      surfaces: [{ cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], surface: 'fire', durationRounds: 5 }],
    });
    const { state } = run(state0, { type: 'MOVE', actorId: 'w', to: { x: 3, y: 0, floor: 0 } });
    expect(state.units.w!.hp).toBe(110 - 6);
  });

  it('fogo criado sob um personagem conta como exposição', () => {
    const state0 = scenario({
      units: [
        { id: 'a', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 4, y: 1 } },
      ],
      surfaces: [{ cells: [{ x: 4, y: 1 }, { x: 5, y: 1 }], surface: 'oil' }],
    });
    const { state } = run(state0, { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.flame', target: entity('b') });
    expect(state.units.b!.hp).toBe(110 - 18 - 6);
    expect(getCell(state.map, { x: 5, y: 1, floor: 0 })!.surface?.kind).toBe('fire');
  });

  it('espinhos não substituem óleo', () => {
    const state0 = scenario({
      units: [
        { id: 'd', classId: 'druid', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 7, y: 7 } },
      ],
      order: ['d', 'dummy'],
      surfaces: [{ cells: [{ x: 3, y: 3 }], surface: 'oil' }],
    });
    const { state } = run(state0, { type: 'USE_ABILITY', actorId: 'd', abilityId: 'druid.thorns', target: cell(3, 3) });
    expect(getCell(state.map, { x: 3, y: 3, floor: 0 })!.surface?.kind).toBe('oil');
    expect(getCell(state.map, { x: 3, y: 2, floor: 0 })!.surface?.kind).toBe('thorns');
  });

  it('superfície criada na rodada R com duração 3 expira no início de R + 3', () => {
    const state0 = scenario({
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 0, y: 0 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 7, y: 7 } },
      ],
      order: ['mage', 'dummy'],
      surfaces: [{ cells: [{ x: 3, y: 0 }], surface: 'oil' }],
    });
    let { state } = run(state0, { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: cell(3, 0) });
    const fire = () => getCell(state.map, { x: 3, y: 0, floor: 0 })!.surface?.kind ?? null;
    expect(fire()).toBe('fire');
    ({ state } = runAll(state, [endTurn('mage'), endTurn('mage')]));
    expect(state.turn.round).toBe(3);
    expect(fire()).toBe('fire');
    ({ state } = run(state, endTurn('mage')));
    expect(state.turn.round).toBe(4);
    expect(fire()).toBeNull();
  });
});

describe('objetos interativos', () => {
  it('porta fechada bloqueia caminho; aberta libera', () => {
    const state = buildScenario(catalog, {
      map: { floors: [['#####', '.....', '#####']] },
      units: [{ id: 'w', classId: 'warrior', team: 'A', pos: { x: 0, y: 1 } }],
      objects: [{ id: 'door', defId: 'door', pos: { x: 2, y: 1 } }],
    });
    const blocked = applyCommand(state, catalog, { type: 'MOVE', actorId: 'w', to: { x: 4, y: 1, floor: 0 } });
    expect(blocked.ok ? null : blocked.error.code).toBe('NO_PATH');
    const { state: after } = runAll(state, [
      { type: 'MOVE', actorId: 'w', to: { x: 1, y: 1, floor: 0 } },
      { type: 'INTERACT', actorId: 'w', objectId: 'door' },
      { type: 'MOVE', actorId: 'w', to: { x: 4, y: 1, floor: 0 } },
    ]);
    expect(after.objects.door!.state).toBe('open');
    expect(after.units.w!.pos).toEqual({ x: 4, y: 1, floor: 0 });
  });

  it('baú concede poção uma única vez', () => {
    const state = buildScenario(catalog, {
      map: { floors: [openMap(4, 4)] },
      units: [{ id: 'w', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 } }],
      objects: [{ id: 'chest', defId: 'chest', pos: { x: 1, y: 0 } }],
    });
    const { state: after } = run(state, { type: 'INTERACT', actorId: 'w', objectId: 'chest' });
    expect(after.units.w!.consumables).toEqual(['consumable.health_potion']);
    const again = applyCommand(after, catalog, { type: 'INTERACT', actorId: 'w', objectId: 'chest' });
    expect(again.ok ? null : again.error.code).toBe('NO_USES_LEFT');
  });
});

describe('fim de partida', () => {
  it('vitória por eliminação', () => {
    const state0 = scenario({
      units: [
        { id: 'a', classId: 'warrior', team: 'A', pos: { x: 3, y: 3 } },
        { id: 'b', classId: 'mage', team: 'B', pos: { x: 4, y: 3 }, hp: 5 },
      ],
    });
    const { state } = run(state0, { type: 'BASIC_ATTACK', actorId: 'a', weaponId: 'weapon.iron_sword', target: entity('b') });
    expect(state.status).toBe('finished');
    expect(state.result).toEqual({ kind: 'victory', winnerTeam: 'A', reason: 'elimination' });
  });

  it('morte simultânea após explosão resulta em empate', () => {
    const state0 = scenario({
      units: [
        { id: 'a', classId: 'mage', team: 'A', pos: { x: 3, y: 2 }, hp: 5 },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 5, y: 3 }, hp: 5 },
      ],
      objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 4, y: 3 } }],
    });
    const { state } = run(state0, { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.flame', target: cell(4, 3) });
    expect(state.result).toEqual({ kind: 'draw', reason: 'mutualDestruction' });
  });

  it('limite de rodadas resulta em empate', () => {
    const state0 = scenario({
      maxRounds: 2,
      units: [
        { id: 'a', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 7, y: 7 } },
      ],
    });
    const { state } = runAll(state0, [endTurn('a'), endTurn('b'), endTurn('a'), endTurn('b')]);
    expect(state.result).toEqual({ kind: 'draw', reason: 'roundLimit' });
  });
});

describe('determinismo', () => {
  it('mesmo estado + mesmos comandos = mesmo resultado; estado original intacto', () => {
    const make = () =>
      scenario({
        units: [
          { id: 'a', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
          { id: 'b', classId: 'warrior', team: 'B', pos: { x: 5, y: 3 } },
        ],
        objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 4, y: 3 } }],
        surfaces: [{ cells: [{ x: 3, y: 3 }, { x: 3, y: 4 }], surface: 'oil' }],
      });
    const commands = [
      { type: 'USE_ABILITY', actorId: 'a', abilityId: 'mage.flame', target: cell(3, 3) },
      endTurn('a'),
      { type: 'MOVE', actorId: 'b', to: { x: 5, y: 5, floor: 0 } },
    ] as const;
    const initial = make();
    const snapshot = JSON.stringify(initial);
    const r1 = runAll(initial, [...commands]);
    const r2 = runAll(make(), [...commands]);
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
});
