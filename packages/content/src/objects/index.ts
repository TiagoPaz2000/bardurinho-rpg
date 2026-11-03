import type { DummyPresetDefinition, MapObjectDefinition } from '@bardurinho/domain';

/** Objetos do mapa (seção 6.1). */
export const objects: MapObjectDefinition[] = [
  {
    kind: 'object', id: 'door', version: 1, name: 'Porta de madeira', tags: ['WOOD', 'FLAMMABLE', 'INTERACTIVE'],
    hp: 30, material: 'wood', initialState: 'closed',
    blocksMovementIn: ['closed'], blocksVisionIn: ['closed'],
    flammable: true, combustionDamage: 6,
    interaction: { kind: 'toggleDoor' },
  },
  {
    kind: 'object', id: 'gate', version: 1, name: 'Portão central', tags: ['METAL', 'INDESTRUCTIBLE'],
    hp: null, material: 'metal', initialState: 'closed',
    blocksMovementIn: ['closed'], blocksVisionIn: [],
    flammable: false,
  },
  {
    kind: 'object', id: 'lever', version: 1, name: 'Alavanca do portão', tags: ['INTERACTIVE'],
    hp: null, material: 'metal', initialState: 'closed',
    blocksMovementIn: ['normal', 'open', 'closed', 'used'], blocksVisionIn: [],
    flammable: false,
    interaction: { kind: 'toggleLinked' },
  },
  {
    kind: 'object', id: 'barrel', version: 1, name: 'Barril explosivo', tags: ['WOOD', 'FLAMMABLE', 'EXPLOSIVE'],
    hp: 8, material: 'wood', initialState: 'normal',
    blocksMovementIn: ['normal'], blocksVisionIn: [],
    flammable: true,
    explosion: { damage: 20, damageType: 'fire', radius: 1 },
  },
  {
    kind: 'object', id: 'crate', version: 1, name: 'Caixa / barricada', tags: ['WOOD', 'FLAMMABLE', 'COVER'],
    hp: 20, material: 'wood', initialState: 'normal',
    blocksMovementIn: ['normal'], blocksVisionIn: ['normal'],
    flammable: true, combustionDamage: 6,
  },
  {
    kind: 'object', id: 'cistern', version: 1, name: 'Cisterna', tags: ['WATER', 'INTERACTIVE'],
    hp: null, material: 'water', initialState: 'normal',
    blocksMovementIn: ['normal', 'used'], blocksVisionIn: [],
    flammable: false,
    interaction: { kind: 'emitWater' }, maxUses: 1,
  },
  {
    kind: 'object', id: 'chest', version: 1, name: 'Baú de suprimentos', tags: ['WOOD', 'INTERACTIVE'],
    hp: null, material: 'wood', initialState: 'normal',
    blocksMovementIn: ['normal', 'used'], blocksVisionIn: [],
    flammable: false,
    interaction: { kind: 'grantConsumable', itemId: 'consumable.health_potion' }, maxUses: 1,
  },
  {
    kind: 'object', id: 'focus_altar', version: 1, name: 'Altar de Foco', tags: ['STONE', 'INTERACTIVE'],
    hp: null, material: 'stone', initialState: 'normal',
    blocksMovementIn: ['normal', 'used'], blocksVisionIn: [],
    flammable: false,
    interaction: { kind: 'restoreFocus', amount: 4 }, maxUses: 1,
  },
];

/** Presets do Test Dummy (Combat Debug Lab). Não fazem parte do conteúdo do jogo. */
export const dummies: DummyPresetDefinition[] = [
  { kind: 'dummy', id: 'dummy.default', version: 1, name: 'Test Dummy — Padrão', tags: ['debug'], hp: 100, armor: 0, resistances: {}, immortal: false, canMove: false },
  { kind: 'dummy', id: 'dummy.armored', version: 1, name: 'Test Dummy — Armadura Alta', tags: ['debug'], hp: 100, armor: 10, resistances: {}, immortal: false, canMove: false },
  { kind: 'dummy', id: 'dummy.fire_resistant', version: 1, name: 'Test Dummy — Resistente a Fogo', tags: ['debug', 'FIRE'], hp: 100, armor: 0, resistances: { fire: 10 }, immortal: false, canMove: false },
  { kind: 'dummy', id: 'dummy.cold_resistant', version: 1, name: 'Test Dummy — Resistente a Frio', tags: ['debug', 'COLD'], hp: 100, armor: 0, resistances: { cold: 10 }, immortal: false, canMove: false },
  { kind: 'dummy', id: 'dummy.fragile', version: 1, name: 'Test Dummy — Frágil', tags: ['debug'], hp: 50, armor: 0, resistances: {}, immortal: false, canMove: false },
  { kind: 'dummy', id: 'dummy.immortal', version: 1, name: 'Test Dummy — Imortal', tags: ['debug'], hp: 100, armor: 0, resistances: {}, immortal: true, canMove: false },
  { kind: 'dummy', id: 'dummy.environmental', version: 1, name: 'Test Dummy — Ambiental', tags: ['debug'], hp: 100, armor: 0, resistances: {}, immortal: false, canMove: false },
];
