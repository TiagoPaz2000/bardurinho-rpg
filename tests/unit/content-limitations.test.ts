/**
 * Fase 4 — limitações do conteúdo (seções 3 e 4 do plano) que os cenários só verificam
 * pela contagem de erros: aqui conferimos o código exato de cada recusa, e regras do
 * catálogo que não passam por comandos (armaduras, acessórios, inventário inicial).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyCommand, createUnitFromClass, runScenario, type Command, type ScenarioInitial } from '@bardurinho/domain';
import { catalog, cell, entity, scenario } from './helpers.js';

const scenariosRoot = fileURLToPath(new URL('../scenarios/', import.meta.url));

function errorCodes(path: string): string[] {
  const dir = join(scenariosRoot, path);
  const initial = JSON.parse(readFileSync(join(dir, 'initial.json'), 'utf8')) as ScenarioInitial;
  const commands = existsSync(join(dir, 'commands.json')) ? (JSON.parse(readFileSync(join(dir, 'commands.json'), 'utf8')) as Command[]) : [];
  return runScenario(catalog, initial, commands, { allowDebugCommands: true }).errors.map((e) => e.error.code);
}

describe('códigos de recusa dos cenários de limitação', () => {
  const expected: Record<string, string[]> = {
    'abilities/rogue_precise_shot_limits': ['TOO_CLOSE', 'OUT_OF_RANGE', 'NO_LINE_OF_SIGHT'],
    'abilities/rogue_hide_denied_in_sight': ['HIDE_NOT_ALLOWED'],
    'abilities/warrior_charge_blocked_by_door': ['NO_PATH'],
    'abilities/warrior_charge_blocked_by_unit': ['NO_PATH'],
    'abilities/warrior_charge_other_floor': ['DIFFERENT_FLOOR'],
    'abilities/druid_root': ['ROOTED'],
    'items/iron_sword_same_floor_only': ['DIFFERENT_FLOOR'],
    'items/dagger_melee': ['OUT_OF_RANGE'],
    'items/short_bow_range': ['TOO_CLOSE', 'OUT_OF_RANGE'],
    'items/arcane_wand': ['OUT_OF_RANGE'],
    'items/nature_staff': ['OUT_OF_RANGE'],
    'items/health_potion': ['NOT_EQUIPPED'],
    'items/oil_flask_limits': ['NO_LINE_OF_SIGHT', 'OUT_OF_RANGE'],
    'statuses/defend_once_per_turn': ['MAX_USES_REACHED'],
    'statuses/hidden_ends_on_damage': ['TARGET_NOT_VISIBLE'],
    'statuses/hidden_persists_through_enemy_turn': ['TARGET_NOT_VISIBLE'],
    'statuses/rooted_during_target_turn': ['ROOTED'],
    'surfaces/oil_enter_cost': ['NOT_ENOUGH_MP'],
    'reactions/cistern_water': ['NO_USES_LEFT'],
    'objects/door_open_close': ['NO_PATH'],
    'objects/door_occupied_cannot_close': ['CELL_OCCUPIED'],
    'objects/door_destructible': ['NOT_ADJACENT'],
    'objects/gate_and_lever': ['NOT_INTERACTABLE', 'NO_PATH'],
    'objects/gate_cannot_close_on_unit': ['CELL_OCCUPIED'],
    'objects/crate_blocks_and_breaks': ['NO_PATH'],
    'objects/chest_grants_potion': ['NO_USES_LEFT'],
    'objects/chest_needs_inventory_space': ['INVENTORY_FULL', 'INVENTORY_FULL'],
    'objects/focus_altar': ['NO_USES_LEFT'],
    'visibility/dark_area_detection_range': ['TARGET_NOT_VISIBLE'],
    'visibility/closed_door_blocks_vision': ['NO_LINE_OF_SIGHT'],
    'visibility/crate_blocks_vision': ['NO_LINE_OF_SIGHT'],
    'cooldowns/recharge_0_once_per_turn': ['MAX_USES_REACHED'],
    'cooldowns/recharge_1_frost_ray': ['ON_COOLDOWN'],
    'cooldowns/recharge_2_arcane_barrier': ['ON_COOLDOWN', 'ON_COOLDOWN'],
  };
  for (const [path, codes] of Object.entries(expected)) {
    it(path, () => expect(errorCodes(path)).toEqual(codes));
  }
});

describe('itens: armaduras fixas por classe e acessórios (seção 3.2)', () => {
  it('armadura do equipamento inicial: mago 0, ladino 2, guerreiro 4, druida 2', () => {
    const armorOf = (classId: string) => createUnitFromClass(catalog, { id: 'u', classId, team: 'A', pos: { x: 0, y: 0, floor: 0 } });
    expect(Object.fromEntries(['mage', 'rogue', 'warrior', 'druid'].map((c) => [c, [armorOf(c).armorId, armorOf(c).armor]]))).toEqual({
      mage: ['armor.tunic', 0],
      rogue: ['armor.leather', 2],
      warrior: ['armor.reinforced_mail', 4],
      druid: ['armor.leather', 2],
    });
  });

  it('acessórios: +8 PV máximos, resistência a fogo 2, resistência a frio 2', () => {
    const make = (accessoryId: string) => createUnitFromClass(catalog, { id: 'u', classId: 'mage', team: 'A', pos: { x: 0, y: 0, floor: 0 }, accessoryId });
    expect([make('accessory.vitality_amulet').maxHp, make('accessory.vitality_amulet').hp]).toEqual([88, 88]);
    expect(make('accessory.ash_medallion').resistances).toEqual({ fire: 2 });
    expect(make('accessory.frost_medallion').resistances).toEqual({ cold: 2 });
  });

  it('um único acessório, que precisa ser um acessório', () => {
    expect(() => createUnitFromClass(catalog, { id: 'u', classId: 'mage', team: 'A', pos: { x: 0, y: 0, floor: 0 }, accessoryId: 'weapon.dagger' })).toThrow();
  });
});

describe('consumíveis: dois espaços, tipos diferentes (seção 3.3)', () => {
  const spec = (consumables: string[]) => ({ id: 'u', classId: 'rogue', team: 'A', pos: { x: 0, y: 0, floor: 0 }, consumables });
  it('aceita dois tipos diferentes', () => {
    expect(createUnitFromClass(catalog, spec(['consumable.health_potion', 'consumable.oil_flask'])).consumables).toHaveLength(2);
  });
  it('recusa repetição de tipo e mais de dois', () => {
    expect(() => createUnitFromClass(catalog, spec(['consumable.health_potion', 'consumable.health_potion']))).toThrow();
    expect(() => createUnitFromClass(catalog, spec(['consumable.health_potion', 'consumable.focus_potion', 'consumable.oil_flask']))).toThrow();
  });
});

describe('Tiro preciso exige arco (seção 4)', () => {
  it('sem arco equipado: MISSING_WEAPON', () => {
    const s = scenario({
      units: [
        { id: 'rogue', classId: 'rogue', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 1, y: 5 } },
      ],
      order: ['rogue'],
    });
    s.units.rogue!.weapons = ['weapon.dagger'];
    const r = applyCommand(s, catalog, { type: 'USE_ABILITY', actorId: 'rogue', abilityId: 'rogue.precise_shot', target: entity('dummy') });
    expect(r.ok ? 'OK' : r.error.code).toBe('MISSING_WEAPON');
  });

  it('com arco, a 2 células (mínimo), é aceito', () => {
    const s = scenario({
      units: [
        { id: 'rogue', classId: 'rogue', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'dummy', type: 'debug.test-dummy', pos: { x: 1, y: 3 } },
      ],
      order: ['rogue'],
    });
    const r = applyCommand(s, catalog, { type: 'USE_ABILITY', actorId: 'rogue', abilityId: 'rogue.precise_shot', target: cell(1, 3) });
    expect(r.ok).toBe(true);
  });
});

describe('portão e alavanca (seção 6.1)', () => {
  const gateScenario = (gateState: 'open' | 'closed', occupied: boolean) =>
    scenario({
      map: { floors: [['........', '###.####', '........', '........']] },
      units: [
        { id: 'w', classId: 'warrior', team: 'A', pos: { x: 2, y: 2 } },
        ...(occupied ? [{ id: 'r', classId: 'rogue', team: 'A', pos: { x: 3, y: 1 } }] : []),
      ],
      objects: [
        { id: 'gate', defId: 'gate', pos: { x: 3, y: 1 }, state: gateState },
        { id: 'lever', defId: 'lever', pos: { x: 1, y: 2 }, linkedId: 'gate' },
      ],
      order: ['w'],
    });
  const lever: Command = { type: 'INTERACT', actorId: 'w', objectId: 'lever' };

  it('a alavanca não fecha o portão sobre um personagem (CELL_OCCUPIED, como a porta)', () => {
    const r = applyCommand(gateScenario('open', true), catalog, lever);
    expect(r.ok ? 'OK' : r.error.code).toBe('CELL_OCCUPIED');
  });

  it('com a passagem livre, a alavanca alterna o portão', () => {
    const r = applyCommand(gateScenario('open', false), catalog, lever);
    expect(r.ok && r.state.objects.gate!.state).toBe('closed');
    // Abrir nunca é bloqueado por ocupação (a célula do portão fechado não pode estar ocupada).
    const o = applyCommand(gateScenario('closed', false), catalog, lever);
    expect(o.ok && o.state.objects.gate!.state).toBe('open');
  });
});

describe('dados do catálogo conferem com o plano (seções 3 e 4)', () => {
  it('custos e recargas das 10 habilidades', () => {
    const table = Object.fromEntries(
      Object.values(catalog.abilities).map((a) => [a.id, [a.cost.ap, a.cost.focus ?? 0, a.blockedOwnTurnsAfterUse, a.maxUsesPerTurn]]),
    );
    expect(table).toEqual({
      'mage.flame': [1, 2, 0, 1],
      'mage.frost_ray': [1, 2, 1, 1],
      'mage.arcane_barrier': [1, 3, 2, 1],
      'rogue.precise_shot': [1, 3, 1, 1],
      'rogue.hide': [1, 2, 2, 1],
      'warrior.charge': [1, 2, 1, 1],
      'warrior.push': [1, 2, 1, 1],
      'druid.thorns': [1, 3, 1, 1],
      'druid.natural_heal': [1, 4, 2, 1],
      'druid.root': [1, 3, 2, 1],
    });
  });

  it('alcances das armas e habilidades', () => {
    const range = (t: { kind: string; range?: number; minRange?: number }) => [t.minRange ?? 0, t.range ?? 0];
    const weapons = Object.fromEntries(Object.values(catalog.items).filter((i) => i.kind === 'weapon').map((w) => [w.id, range(w.target)]));
    expect(weapons).toEqual({
      'weapon.iron_sword': [0, 1],
      'weapon.dagger': [0, 1],
      'weapon.short_bow': [2, 6],
      'weapon.arcane_wand': [0, 5],
      'weapon.nature_staff': [0, 4],
    });
    const abilities = Object.fromEntries(Object.values(catalog.abilities).filter((a) => a.target.kind !== 'self').map((a) => [a.id, range(a.target)]));
    expect(abilities).toEqual({
      'mage.flame': [0, 6],
      'mage.frost_ray': [0, 6],
      'rogue.precise_shot': [2, 7],
      'warrior.charge': [0, 5],
      'warrior.push': [0, 1],
      'druid.thorns': [0, 5],
      'druid.root': [0, 5],
    });
  });
});
