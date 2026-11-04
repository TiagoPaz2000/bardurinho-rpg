import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  attackHitChance,
  coordKey,
  listTargetCells,
  listValidTargets,
  previewArea,
  previewTargets,
  saveSuccessChance,
  targetedCommand,
} from '@bardurinho/domain';
import { catalog, scenario } from './helpers.js';

const keys = (cells: Array<{ x: number; y: number; floor: number }>) => cells.map(coordKey).sort();

describe('mira: células-alvo válidas (sondando o motor)', () => {
  const duel = () =>
    scenario({
      map: {
        floors: [
          [
            '........',
            '........',
            '...#....',
            '........',
            '........',
            '........',
            '........',
            '........',
          ],
        ],
      },
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 2 } },
        { id: 'war', classId: 'warrior', team: 'B', pos: { x: 6, y: 2 } },
      ],
      objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 1, y: 5 } }],
    });

  it('toda célula válida é aceita pelo motor e toda inválida é recusada com o mesmo motivo', () => {
    const s = duel();
    const action = { kind: 'ability' as const, id: 'mage.flame' };
    const cells = listTargetCells(s, catalog, 'mage', action);
    expect(cells.length).toBeGreaterThan(0);
    for (const t of cells) {
      const r = applyCommand(s, catalog, targetedCommand('mage', action, { kind: 'cell', ...t.cell }));
      expect(r.ok).toBe(t.valid);
      if (!r.ok) expect(t.reason?.code).toBe(r.error.code);
    }
    // Só chão dentro do alcance (paredes ficam de fora).
    expect(cells.some((t) => t.cell.x === 3 && t.cell.y === 2)).toBe(false);
    // A parede em (3,2) bloqueia a linha de visão para (5,2).
    expect(cells.find((t) => t.cell.x === 5 && t.cell.y === 2)?.reason?.code).toBe('NO_LINE_OF_SIGHT');
  });

  it('listValidTargets = células válidas; arma corpo a corpo só alcança as adjacentes', () => {
    const s = scenario({
      units: [
        { id: 'war', classId: 'warrior', team: 'A', pos: { x: 3, y: 3 } },
        { id: 'mage', classId: 'mage', team: 'B', pos: { x: 3, y: 4 } },
      ],
    });
    const valid = listValidTargets(s, catalog, 'war', { kind: 'attack', id: 'weapon.iron_sword' });
    expect(keys(valid)).toEqual(keys([
      { x: 3, y: 2, floor: 0 },
      { x: 4, y: 3, floor: 0 },
      { x: 3, y: 4, floor: 0 },
      { x: 2, y: 3, floor: 0 },
    ]));
    // Habilidade de alvo "personagem": só a célula ocupada pelo inimigo.
    expect(keys(listValidTargets(s, catalog, 'war', { kind: 'ability', id: 'warrior.push' }))).toEqual(['3,4,0']);
    // Habilidade sobre si mesmo não tem células.
    expect(listTargetCells(s, catalog, 'war', { kind: 'ability', id: 'mage.arcane_barrier' })).toEqual([]);
  });

  it('fora do turno nenhuma célula é válida', () => {
    const s = duel();
    const cells = listTargetCells(s, catalog, 'war', { kind: 'attack', id: 'weapon.iron_sword' });
    expect(cells.every((t) => !t.valid && t.reason?.code === 'WRONG_TURN')).toBe(true);
  });
});

describe('mira: área afetada e chance de acerto', () => {
  it('Espinheiro e Frasco de óleo afetam a cruz; Chama só a célula alvo', () => {
    const s = scenario({ units: [{ id: 'druid', classId: 'druid', team: 'A', pos: { x: 0, y: 0 } }] });
    const center = { x: 3, y: 3, floor: 0 };
    const cross = keys([center, { x: 3, y: 2, floor: 0 }, { x: 4, y: 3, floor: 0 }, { x: 3, y: 4, floor: 0 }, { x: 2, y: 3, floor: 0 }]);
    expect(keys(previewArea(s, catalog, 'druid', { kind: 'ability', id: 'druid.thorns' }, center))).toEqual(cross);
    expect(keys(previewArea(s, catalog, 'druid', { kind: 'item', id: 'consumable.oil_flask' }, center))).toEqual(cross);
    expect(keys(previewArea(s, catalog, 'druid', { kind: 'ability', id: 'mage.flame' }, center))).toEqual(['3,3,0']);
    // Na borda do mapa a cruz é cortada.
    expect(previewArea(s, catalog, 'druid', { kind: 'ability', id: 'druid.thorns' }, { x: 0, y: 7, floor: 0 })).toHaveLength(3);
  });

  it('Bola de fogo afeta o quadrado 3×3, sem as células atrás de parede', () => {
    const fireball = { kind: 'ability', id: 'mage.fireball' } as const;
    const open = scenario({ units: [{ id: 'mage', classId: 'mage', team: 'A', pos: { x: 0, y: 0 } }] });
    expect(previewArea(open, catalog, 'mage', fireball, { x: 3, y: 3, floor: 0 })).toHaveLength(9);
    expect(previewArea(open, catalog, 'mage', fireball, { x: 0, y: 7, floor: 0 })).toHaveLength(4);
    const walled = scenario({
      map: { floors: [['........', '........', '....#...', '....#...', '....#...', '........', '........', '........']] },
      units: [{ id: 'mage', classId: 'mage', team: 'A', pos: { x: 0, y: 0 } }],
    });
    const cells = keys(previewArea(walled, catalog, 'mage', fireball, { x: 3, y: 3, floor: 0 }));
    expect(cells).toHaveLength(6);
    expect(cells.some((k) => k.startsWith('4,'))).toBe(false);
  });

  it('Bola de fogo: todos na área (aliados também) sem jogada de ataque, com chance do teste de resistência', () => {
    const s = scenario({
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 0, y: 3 } },
        { id: 'ally', classId: 'druid', team: 'A', pos: { x: 3, y: 2 } },
        { id: 'war', classId: 'warrior', team: 'B', pos: { x: 4, y: 3 } },
        { id: 'far', classId: 'rogue', team: 'B', pos: { x: 7, y: 3 } },
      ],
      objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 5, y: 4 } }],
    });
    const targets = previewTargets(s, catalog, 'mage', { kind: 'ability', id: 'mage.fireball' }, { x: 4, y: 3, floor: 0 });
    expect(targets.map((t) => t.entityId).sort()).toEqual(['ally', 'barrel', 'war']);
    for (const t of targets) expect(t).toMatchObject({ attackRoll: false, hitChance: 1 });
    // CD 13: passa com 13–20 (8 em 20).
    expect(targets.find((t) => t.entityId === 'war')!.save).toEqual({ dc: 13, successChance: 0.4 });
    expect(targets.find((t) => t.entityId === 'barrel')!.save).toBeUndefined();
    expect(saveSuccessChance(13)).toBeCloseTo(0.4);
    expect(saveSuccessChance(1)).toBeCloseTo(0.95); // 1 natural falha sempre
    expect(saveSuccessChance(25)).toBeCloseTo(0.05); // 20 natural passa sempre
  });

  it('chance de acerto: d20 + bônus ≥ Defesa, limitada a 5%–95%', () => {
    expect(attackHitChance(5, 14)).toBeCloseTo(0.6); // precisa de 9+
    expect(attackHitChance(5, 11)).toBeCloseTo(0.75);
    expect(attackHitChance(20, 5)).toBeCloseTo(0.95); // 1 natural sempre erra
    expect(attackHitChance(0, 30)).toBeCloseTo(0.05); // 20 natural sempre acerta
    for (let def = 0; def <= 30; def++) {
      expect(attackHitChance(5, def)).toBeCloseTo(Math.max(0.05, Math.min(0.95, (21 - (def - 5)) / 20)));
    }
  });

  it('alvos da prévia: personagem com jogada de ataque, objeto automático', () => {
    const s = scenario({
      units: [
        { id: 'mage', classId: 'mage', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'war', classId: 'warrior', team: 'B', pos: { x: 4, y: 1 } },
      ],
      objects: [{ id: 'barrel', defId: 'barrel', pos: { x: 1, y: 4 } }],
    });
    const onWarrior = previewTargets(s, catalog, 'mage', { kind: 'attack', id: 'weapon.arcane_wand' }, { x: 4, y: 1, floor: 0 });
    expect(onWarrior).toEqual([
      expect.objectContaining({ entityId: 'war', entity: 'unit', attackRoll: true, defense: 14, attackBonus: 5, hitChance: 0.6 }),
    ]);
    const onBarrel = previewTargets(s, catalog, 'mage', { kind: 'ability', id: 'mage.flame' }, { x: 1, y: 4, floor: 0 });
    expect(onBarrel).toEqual([expect.objectContaining({ entityId: 'barrel', entity: 'object', attackRoll: false, hitChance: 1 })]);
    expect(previewTargets(s, catalog, 'mage', { kind: 'ability', id: 'mage.flame' }, { x: 5, y: 5, floor: 0 })).toEqual([]);
  });
});
