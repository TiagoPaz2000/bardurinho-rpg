import { describe, expect, it } from 'vitest';
import { listActionsOnTarget, listUnitActions } from '@bardurinho/domain';
import { catalog, entity, run, scenario } from './helpers.js';

const duel = () =>
  scenario({
    units: [
      { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
      { id: 'war', classId: 'warrior', team: 'B', pos: { x: 4, y: 1 } },
    ],
    objects: [{ id: 'chest', defId: 'chest', pos: { x: 2, y: 1 } }],
  });

const byKey = (list: ReturnType<typeof listUnitActions>, key: string) => list.find((a) => a.key === key)!;

describe('disponibilidade de ações', () => {
  it('lista ações do personagem ativo com custo e alvos válidos', () => {
    const actions = listUnitActions(duel(), catalog, 'mage');
    expect(byKey(actions, 'ability:mage.flame')).toMatchObject({ available: true, cost: '1 PA + 2 Foco' });
    expect(byKey(actions, 'ability:mage.flame').validTargets).toBeGreaterThan(0);
    expect(byKey(actions, 'ability:mage.arcane_barrier')).toMatchObject({ available: true, target: 'self' });
    expect(byKey(actions, 'move').available).toBe(true);
  });

  it('indisponível com o mesmo motivo que o motor usaria', () => {
    const { state } = run(duel(), { type: 'USE_ABILITY', actorId: 'mage', abilityId: 'mage.flame', target: entity('war') });
    expect(byKey(listUnitActions(state, catalog, 'mage'), 'ability:mage.flame').reason?.code).toBe('MAX_USES_REACHED');
    expect(byKey(listUnitActions(state, catalog, 'war'), 'defend').reason?.code).toBe('WRONG_TURN');
  });

  it('ações sobre um objeto: interagir exige adjacência', () => {
    const near = listActionsOnTarget(duel(), catalog, 'mage', 'chest');
    expect(near.find((a) => a.kind === 'interact')).toMatchObject({ available: true, name: 'Abrir baú' });
    const far = scenario({
      units: [{ id: 'mage', classId: 'mage', team: 'A', pos: { x: 6, y: 6 } }],
      objects: [{ id: 'chest', defId: 'chest', pos: { x: 2, y: 1 } }],
    });
    expect(listActionsOnTarget(far, catalog, 'mage', 'chest').find((a) => a.kind === 'interact')?.reason?.code).toBe('NOT_ADJACENT');
  });
});

describe('DEBUG_REMOVE_ENTITY', () => {
  it('remove objeto e personagem ativo; a vez passa ao próximo', async () => {
    const { applyCommand } = await import('@bardurinho/domain');
    let r = applyCommand(duel(), catalog, { type: 'DEBUG_REMOVE_ENTITY', entityId: 'chest' }, { allowDebugCommands: true });
    expect(r.ok && r.state.objects.chest).toBeUndefined();
    r = applyCommand(r.state, catalog, { type: 'DEBUG_REMOVE_ENTITY', entityId: 'mage' }, { allowDebugCommands: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.units.mage).toBeUndefined();
    expect(r.state.turn.activeUnitId).toBe('war');
    expect(r.state.turn.order).toEqual(['war']);
  });
});
