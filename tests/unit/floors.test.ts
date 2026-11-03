import { describe, expect, it } from 'vitest';
import { patioDasRuinas } from '@bardurinho/content';
import { applyCommand, buildScenario, computeTeamVision, findPath, lineOfSight } from '@bardurinho/domain';
import { catalog } from './helpers.js';

const c = (x: number, y: number, floor = 0) => ({ x, y, floor });
const patio = () => buildScenario(catalog, patioDasRuinas.scenario);

describe('Pátio das Ruínas', () => {
  it('monta o mapa do plano: 16×16, 2 andares, 2 escadas', () => {
    const s = patio();
    expect(s.map).toMatchObject({ width: 16, height: 16, floors: 2 });
    expect(s.map.connections).toHaveLength(2);
    expect(Object.values(s.objects).filter((o) => o.defId === 'barrel')).toHaveLength(4);
  });

  it('pontos de início sem visão direta entre si', () => {
    const s = patio();
    expect(computeTeamVision(s, catalog, 'A').visibleUnits.has('mage-01')).toBe(false);
  });

  it('a escada liga o térreo à plataforma com custo 2', () => {
    const s = patio();
    const p = findPath(s, catalog, c(0, 2), c(0, 5, 1));
    expect(p?.cost).toBe(1 + 2 + 1);
  });
});

describe('linha de visão entre andares', () => {
  it('da borda da plataforma enxerga o chão à frente', () => {
    expect(lineOfSight(patio(), catalog, c(1, 5, 1), c(3, 5, 0)).visible).toBe(true);
  });

  it('não enxerga através da própria plataforma (laje)', () => {
    const los = lineOfSight(patio(), catalog, c(1, 4, 1), c(0, 6, 0));
    expect(los).toMatchObject({ visible: false, reason: 'FLOOR_BLOCK' });
    expect(lineOfSight(patio(), catalog, c(0, 5, 1), c(0, 5, 0)).reason).toBe('FLOOR_BLOCK');
  });

  it('do alto, enxerga por cima do muro central', () => {
    const s = patio();
    // No térreo, o muro (y = 7) bloqueia; da plataforma, a linha passa acima dele.
    expect(lineOfSight(s, catalog, c(1, 6, 0), c(4, 9, 0)).visible).toBe(false);
    expect(lineOfSight(s, catalog, c(1, 6, 1), c(4, 9, 0)).visible).toBe(true);
  });

  it('corpo a corpo exige o mesmo andar', () => {
    const s = buildScenario(catalog, {
      ...patioDasRuinas.scenario,
      units: [
        { id: 'a', classId: 'warrior', team: 'A', pos: { x: 1, y: 5, floor: 1 } },
        { id: 'b', classId: 'warrior', team: 'B', pos: { x: 2, y: 5, floor: 0 } },
      ],
      order: ['a', 'b'],
    });
    const r = applyCommand(s, catalog, { type: 'BASIC_ATTACK', actorId: 'a', weaponId: 'weapon.iron_sword', target: { kind: 'entity', id: 'b' } });
    expect(r.ok ? null : r.error.code).toBe('DIFFERENT_FLOOR');
  });
});
