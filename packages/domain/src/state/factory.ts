import type { Coord, EntityId, Resistances } from '../core/types.js';
import { RULES_VERSION } from '../core/types.js';
import type { GameMap } from '../map/grid.js';
import type { Catalog } from '../rules/definitions.js';
import type { GameState, MapObject, Unit } from './types.js';

export const DEFAULT_MAX_ROUNDS = 20;

export function createGameState(
  catalog: Catalog,
  map: GameMap,
  options: { units?: Unit[]; objects?: MapObject[]; order?: EntityId[]; maxRounds?: number } = {},
): GameState {
  const units = Object.fromEntries((options.units ?? []).map((u) => [u.id, u]));
  const objects = Object.fromEntries((options.objects ?? []).map((o) => [o.id, o]));
  return {
    rulesVersion: RULES_VERSION,
    contentVersion: catalog.contentVersion,
    map,
    units,
    objects,
    turn: {
      round: 0,
      turnId: 0,
      order: options.order ?? (options.units ?? []).map((u) => u.id),
      activeIndex: -1,
      activeUnitId: null,
    },
    status: 'setup',
    result: null,
    maxRounds: options.maxRounds ?? DEFAULT_MAX_ROUNDS,
    surfaceHitsThisTurn: {},
    nextEventSeq: 1,
    nextCommandSeq: 1,
  };
}

function blankUnit(id: EntityId, team: string, pos: Coord): Unit {
  return {
    id,
    entity: 'unit',
    name: id,
    classId: null,
    dummyPresetId: null,
    team,
    pos,
    alive: true,
    hp: 1,
    maxHp: 1,
    ap: 0,
    maxAp: 0,
    mp: 0,
    maxMp: 0,
    focus: 0,
    maxFocus: 0,
    armor: 0,
    resistances: {},
    shield: null,
    weapons: [],
    armorId: null,
    accessoryId: null,
    abilities: [],
    consumables: [],
    statuses: [],
    ownTurnsStarted: 0,
    availableFromOwnTurn: {},
    usesThisTurn: {},
    defendedThisTurn: false,
    flags: {},
  };
}

export interface UnitSpec {
  id: EntityId;
  classId: string;
  team: string;
  pos: Coord;
  name?: string;
  accessoryId?: string | null;
  consumables?: string[];
}

/**
 * Cria um personagem a partir da classe. A armadura vem da roupa equipada e não é
 * somada como atributo de classe (seção 2.1). O acessório pode modificar PV e resistências.
 */
export function createUnitFromClass(catalog: Catalog, spec: UnitSpec): Unit {
  const cls = catalog.classes[spec.classId];
  if (!cls) throw new Error(`Classe desconhecida: ${spec.classId}`);
  const unit = blankUnit(spec.id, spec.team, spec.pos);
  const armor = catalog.items[cls.loadout.armor];
  const accessory = spec.accessoryId ? catalog.items[spec.accessoryId] : undefined;
  if (spec.accessoryId && accessory?.kind !== 'accessory') throw new Error(`Acessório inválido: ${spec.accessoryId}`);
  const maxHp = cls.hp + (accessory?.kind === 'accessory' ? accessory.maxHpBonus ?? 0 : 0);
  const resistances: Resistances = accessory?.kind === 'accessory' ? { ...accessory.resistances } : {};
  const consumables = spec.consumables ?? [];
  if (new Set(consumables).size !== consumables.length || consumables.length > 2) {
    throw new Error('Até dois consumíveis, de tipos diferentes');
  }
  return {
    ...unit,
    name: spec.name ?? spec.id,
    classId: cls.id,
    hp: maxHp,
    maxHp,
    ap: cls.ap,
    maxAp: cls.ap,
    mp: cls.mp,
    maxMp: cls.mp,
    focus: cls.maxFocus,
    maxFocus: cls.maxFocus,
    armor: armor?.kind === 'armor' ? armor.armor : 0,
    resistances,
    weapons: [...cls.loadout.weapons],
    armorId: cls.loadout.armor,
    accessoryId: spec.accessoryId ?? null,
    abilities: [...cls.loadout.abilities],
    consumables: [...consumables],
  };
}

export interface DummySpec {
  id: EntityId;
  presetId: string;
  pos: Coord;
  name?: string;
  team?: string;
  overrides?: Partial<Pick<Unit, 'hp' | 'maxHp' | 'armor' | 'resistances'>> & { immortal?: boolean; canMove?: boolean };
}

/** Boneco de teste instrumentado (`debug.test-dummy`). Não faz parte do conteúdo do jogo. */
export function createDummy(catalog: Catalog, spec: DummySpec): Unit {
  const preset = catalog.dummies[spec.presetId];
  if (!preset) throw new Error(`Preset de boneco desconhecido: ${spec.presetId}`);
  const unit = blankUnit(spec.id, spec.team ?? 'dummy', spec.pos);
  const o = spec.overrides ?? {};
  const maxHp = o.maxHp ?? o.hp ?? preset.hp;
  return {
    ...unit,
    name: spec.name ?? spec.id,
    dummyPresetId: preset.id,
    hp: o.hp ?? maxHp,
    maxHp,
    armor: o.armor ?? preset.armor,
    resistances: { ...preset.resistances, ...o.resistances },
    flags: { isDummy: true, immortal: o.immortal ?? preset.immortal, canMove: o.canMove ?? preset.canMove },
  };
}

/** FULL RESET: retorna o boneco ao preset original, mantendo posição e id. */
export function resetDummy(catalog: Catalog, unit: Unit): void {
  if (!unit.dummyPresetId) return;
  const fresh = createDummy(catalog, { id: unit.id, presetId: unit.dummyPresetId, pos: unit.pos, name: unit.name, team: unit.team });
  Object.assign(unit, fresh, { ownTurnsStarted: unit.ownTurnsStarted });
}

export interface ObjectSpec {
  id: EntityId;
  defId: string;
  pos: Coord;
  state?: MapObject['state'];
  linkedId?: EntityId | null;
}

export function createObject(catalog: Catalog, spec: ObjectSpec): MapObject {
  const def = catalog.objects[spec.defId];
  if (!def) throw new Error(`Objeto desconhecido: ${spec.defId}`);
  return {
    id: spec.id,
    entity: 'object',
    defId: def.id,
    pos: spec.pos,
    hp: def.hp,
    maxHp: def.hp,
    state: spec.state ?? def.initialState,
    burning: false,
    usesLeft: def.maxUses ?? null,
    linkedId: spec.linkedId ?? null,
  };
}
