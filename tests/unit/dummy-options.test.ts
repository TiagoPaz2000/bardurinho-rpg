import { describe, expect, it } from 'vitest';
import { applyCommands, type Command } from '@bardurinho/domain';
import { catalog, entity, scenario } from './helpers.js';

const setup = () =>
  scenario({
    units: [
      { id: 'war', classId: 'warrior', team: 'A', pos: { x: 3, y: 3 } },
      { id: 'dummy', type: 'debug.test-dummy', pos: { x: 4, y: 3 } },
    ],
    surfaces: [{ cells: [{ x: 6, y: 3 }], surface: 'fire', durationRounds: 5 }],
    order: ['war', 'dummy'],
  });
const setFlags = (flags: Record<string, boolean>): Command => ({ type: 'DEBUG_SET_UNIT', unitId: 'dummy', patch: { flags } });
const debug = { allowDebugCommands: true };

describe('opções do Test Dummy', () => {
  it('regenerar: volta ao PV máximo após cada comando', () => {
    const r = applyCommands(setup(), catalog, [
      setFlags({ regenerate: true }),
      { type: 'BASIC_ATTACK', actorId: 'war', weaponId: 'weapon.iron_sword', target: entity('dummy') },
    ], debug);
    expect(r.errors).toEqual([]);
    expect(r.state.units.dummy!.hp).toBe(100);
    expect(r.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.payload.hpDamage === 18)).toBe(true);
  });

  it('imune a empurrão, estados e superfícies', () => {
    const r = applyCommands(setup(), catalog, [
      setFlags({ immuneForcedMove: true, immuneStatuses: true, immuneSurfaces: true }),
      { type: 'USE_ABILITY', actorId: 'war', abilityId: 'warrior.push', target: entity('dummy') },
      { type: 'DEBUG_APPLY_EFFECTS', target: entity('dummy'), effects: [{ op: 'applyStatus', selector: 'targetCellOccupants', statusId: 'burning' }] },
      { type: 'DEBUG_APPLY_EFFECTS', target: entity('dummy'), effects: [{ op: 'createSurface', selector: 'targetCell', surface: 'fire', durationRounds: 2 }] },
    ], debug);
    expect(r.errors).toEqual([]);
    const d = r.state.units.dummy!;
    expect(d.pos).toEqual({ x: 4, y: 3, floor: 0 });
    expect(d.statuses).toEqual([]);
    expect(d.hp).toBe(100 - 6); // só o dano do Empurrão
  });

  it('limpar estados e barreira após cada comando', () => {
    const r = applyCommands(setup(), catalog, [
      setFlags({ clearStatusesAfterCommand: true, clearShieldAfterCommand: true }),
      { type: 'DEBUG_APPLY_EFFECTS', target: entity('dummy'), effects: [
        { op: 'applyStatus', selector: 'targetCellOccupants', statusId: 'slowed' },
        { op: 'grantShield', selector: 'targetCellOccupants', amount: 10, ownTurns: 1 },
      ] },
    ], debug);
    expect(r.state.units.dummy!.statuses).toEqual([]);
    expect(r.state.units.dummy!.shield).toBeNull();
  });
});
