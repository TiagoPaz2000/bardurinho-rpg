import { describe, expect, it } from 'vitest';
import { checkExpectations, runScenario } from '@bardurinho/domain';
import { LabSession } from '../../apps/combat-debug-lab/src/session.js';
import { defaultScenario } from '../../apps/combat-debug-lab/src/defaultScenario.js';
import { catalog } from './helpers.js';

describe('Combat Debug Lab — sessão', () => {
  it('cenário exportado do laboratório vira teste automatizado que passa', () => {
    const lab = new LabSession(catalog, defaultScenario);
    expect(lab.execute({ type: 'USE_ABILITY', actorId: 'mage-01', abilityId: 'mage.flame', target: { kind: 'entity', id: 'dummy-01' } }, {})).toBe(true);
    expect(lab.execute({ type: 'DEBUG_PAINT_SURFACE', cells: [{ x: 5, y: 7, floor: 0 }], surface: 'oil' }, {})).toBe(true);
    expect(lab.execute({ type: 'END_TURN', actorId: 'mage-01' }, {})).toBe(true);

    const { initial, commands, expected } = lab.exportTest('lab/export_roundtrip');
    const run = runScenario(catalog, JSON.parse(JSON.stringify(initial)), commands, { allowDebugCommands: true });
    expect(checkExpectations(run, expected)).toEqual([]);
    expect(expected.units?.['dummy-01']?.hp).toBe(100 - 18);
  });

  it('STEP volta e avança sem recalcular; REPLAY confirma determinismo', () => {
    const lab = new LabSession(catalog, defaultScenario);
    lab.execute({ type: 'MOVE', actorId: 'mage-01', to: { x: 2, y: 7, floor: 0 } }, {});
    lab.execute({ type: 'DEFEND', actorId: 'mage-01' }, {});
    lab.stepBack();
    expect(lab.state.units['mage-01']!.shield).toBeNull();
    lab.stepForward();
    expect(lab.state.units['mage-01']!.shield?.amount).toBe(6);
    expect(lab.replay().identical).toBe(true);
  });

  it('comando inválido não altera a timeline e expõe o erro', () => {
    const lab = new LabSession(catalog, defaultScenario);
    expect(lab.execute({ type: 'DEFEND', actorId: 'warrior-01' }, {})).toBe(false);
    expect(lab.lastError?.code).toBe('WRONG_TURN');
    expect(lab.timeline).toHaveLength(1);
  });
});
