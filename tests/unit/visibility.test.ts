import { describe, expect, it } from 'vitest';
import { applyCommand, canDetectUnit, computeTeamVision, isHidden, projectStateForTeam, type GameState } from '@bardurinho/domain';
import { catalog, cell, endTurn, entity, run, runAll, scenario } from './helpers.js';

const pair = (targetPos: { x: number; y: number }, floors: string[], surfaces?: Parameters<typeof scenario>[0]['surfaces']) =>
  scenario({
    map: { floors: [floors] },
    units: [
      { id: 'obs', classId: 'warrior', team: 'A', pos: { x: 0, y: 0 } },
      { id: 'tgt', classId: 'warrior', team: 'B', pos: targetPos },
    ],
    ...(surfaces ? { surfaces } : {}),
  });
const detects = (s: GameState) => canDetectUnit(s, catalog, s.units.obs!, s.units.tgt!);

describe('visibilidade (seção 6.2)', () => {
  it('visão de até 8 células', () => {
    const open = ['............'];
    expect(detects(pair({ x: 8, y: 0 }, open))).toBe(true);
    expect(detects(pair({ x: 9, y: 0 }, open))).toBe(false);
  });

  it('obstáculos limitam a visão', () => {
    expect(detects(pair({ x: 4, y: 0 }, ['..#.........']))).toBe(false);
  });

  it('em área escura, detecção só a até 2 células — ou quando iluminado por fogo', () => {
    const dark = ['..dddddd....'];
    expect(detects(pair({ x: 2, y: 0 }, dark))).toBe(true);
    expect(detects(pair({ x: 5, y: 0 }, dark))).toBe(false);
    // Fogo a até 2 células ilumina a alcova.
    expect(detects(pair({ x: 5, y: 0 }, dark, [{ cells: [{ x: 6, y: 0 }], surface: 'fire', durationRounds: 3 }]))).toBe(true);
  });

  it('visão da equipe: células visíveis e unidades detectadas', () => {
    const s = pair({ x: 9, y: 0 }, ['............']);
    const v = computeTeamVision(s, catalog, 'A');
    expect(v.visibleCells.has('8,0,0')).toBe(true);
    expect(v.visibleCells.has('9,0,0')).toBe(false);
    expect(v.visibleUnits.has('tgt')).toBe(false);
  });
});

describe('Ocultação (ladino)', () => {
  // Ladino na alcova escura (x 0–1); druida inimigo longe, na parte iluminada.
  const MAP = ['dd..........'];
  const setup = (roguePos = { x: 0, y: 0 }) =>
    scenario({
      map: { floors: [MAP] },
      units: [
        { id: 'rogue', classId: 'rogue', team: 'A', pos: roguePos },
        { id: 'druid', classId: 'druid', team: 'B', pos: { x: 5, y: 0 } },
      ],
    });
  const hide = { type: 'USE_ABILITY', actorId: 'rogue', abilityId: 'rogue.hide', target: { kind: 'self' } } as const;

  it('não pode se ocultar à vista do inimigo fora de área escura', () => {
    const r = applyCommand(setup({ x: 3, y: 0 }), catalog, hide);
    expect(r.ok ? null : r.error.code).toBe('HIDE_NOT_ALLOWED');
  });

  it('oculto: some da visão inimiga e não pode ser mirado diretamente', () => {
    const { state } = runAll(setup(), [hide, endTurn('rogue')]);
    expect(isHidden(state.units.rogue!)).toBe(true);
    expect(projectStateForTeam(state, catalog, 'B').state.units.rogue).toBeUndefined();
    expect(projectStateForTeam(state, catalog, 'A').state.units.rogue).toBeDefined();
    const root = applyCommand(state, catalog, { type: 'USE_ABILITY', actorId: 'druid', abilityId: 'druid.root', target: entity('rogue') });
    expect(root.ok ? null : root.error.code).toBe('TARGET_NOT_VISIBLE');
  });

  it('receber dano encerra a Ocultação (ataque "às cegas" na célula)', () => {
    const { state, events } = runAll(setup(), [
      hide,
      endTurn('rogue'),
      { type: 'USE_ABILITY', actorId: 'druid', abilityId: 'druid.thorns', target: cell(0, 0) },
    ]);
    expect(isHidden(state.units.rogue!)).toBe(false);
    expect(events.some((e) => e.type === 'STATUS_REMOVED' && e.payload.reason === 'damaged')).toBe(true);
  });

  it('primeiro ataque saindo de Oculto: +4 de dano bruto e encerra o efeito', () => {
    // Dano: arco 14 + 4 = 18, armadura de couro 2 → 16.
    const { state } = runAll(setup(), [
      hide,
      endTurn('rogue'),
      endTurn('druid'),
      { type: 'BASIC_ATTACK', actorId: 'rogue', weaponId: 'weapon.short_bow', target: entity('druid') },
    ]);
    expect(state.units.druid!.hp).toBe(95 - 16);
    expect(isHidden(state.units.rogue!)).toBe(false);
  });

  it('termina ao final do próximo turno próprio', () => {
    let { state } = runAll(setup(), [hide, endTurn('rogue'), endTurn('druid')]);
    expect(isHidden(state.units.rogue!)).toBe(true);
    ({ state } = run(state, endTurn('rogue')));
    expect(isHidden(state.units.rogue!)).toBe(false);
  });

  it('inimigo adjacente revela', () => {
    const { state, events } = runAll(setup(), [
      hide,
      endTurn('rogue'),
      { type: 'MOVE', actorId: 'druid', to: { x: 1, y: 0, floor: 0 } },
    ]);
    expect(isHidden(state.units.rogue!)).toBe(false);
    expect(events.some((e) => e.type === 'STATUS_REMOVED' && e.payload.reason === 'revealed_by_druid')).toBe(true);
  });
});
