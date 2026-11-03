import type { ItemDefinition } from '@bardurinho/domain';

/** Catálogo de itens (seção 3): 5 armas, 3 armaduras, 3 acessórios, 3 consumíveis. */
export const items: ItemDefinition[] = [
  // --- Armas: todos os ataques básicos custam 1 PA e nenhum Foco ---
  {
    kind: 'weapon', id: 'weapon.iron_sword', version: 1, name: 'Espada de ferro', tags: ['sword', 'melee'],
    classIds: ['warrior'], cost: { ap: 1 }, damage: '1d8+13', damageType: 'physical',
    target: { kind: 'cell', range: 1, sameFloor: true },
    presentation: { iconId: 'icon.weapon.iron_sword', animationId: 'melee', vfxId: 'impact.physical' },
  },
  {
    kind: 'weapon', id: 'weapon.dagger', version: 1, name: 'Adaga', tags: ['dagger', 'melee'],
    classIds: ['rogue'], cost: { ap: 1 }, damage: '1d6+12', damageType: 'physical',
    target: { kind: 'cell', range: 1, sameFloor: true },
    presentation: { iconId: 'icon.weapon.dagger', animationId: 'melee', vfxId: 'impact.physical' },
  },
  {
    kind: 'weapon', id: 'weapon.short_bow', version: 1, name: 'Arco curto', tags: ['bow', 'ranged'],
    classIds: ['rogue'], cost: { ap: 1 }, damage: '1d6+10', damageType: 'physical',
    target: { kind: 'cell', minRange: 2, range: 6, requiresLineOfSight: true },
    presentation: { iconId: 'icon.weapon.short_bow', animationId: 'shoot', vfxId: 'trail.arrow' },
  },
  {
    kind: 'weapon', id: 'weapon.arcane_wand', version: 1, name: 'Varinha arcana', tags: ['wand', 'ranged'],
    classIds: ['mage'], cost: { ap: 1 }, damage: '1d6+10', damageType: 'arcane',
    target: { kind: 'cell', range: 5, requiresLineOfSight: true },
    presentation: { iconId: 'icon.weapon.arcane_wand', animationId: 'cast_forward', vfxId: 'projectile.arcane' },
  },
  {
    kind: 'weapon', id: 'weapon.nature_staff', version: 1, name: 'Cajado natural', tags: ['staff', 'ranged'],
    classIds: ['druid'], cost: { ap: 1 }, damage: '1d4+9', damageType: 'nature',
    target: { kind: 'cell', range: 4, requiresLineOfSight: true },
    presentation: { iconId: 'icon.weapon.nature_staff', animationId: 'cast_forward', vfxId: 'projectile.nature' },
  },

  // --- Armaduras (fixas por classe) ---
  { kind: 'armor', id: 'armor.tunic', version: 1, name: 'Túnica', tags: ['cloth'], classIds: ['mage'], armor: 0 },
  { kind: 'armor', id: 'armor.leather', version: 1, name: 'Armadura de couro', tags: ['leather'], classIds: ['rogue', 'druid'], armor: 2 },
  { kind: 'armor', id: 'armor.reinforced_mail', version: 1, name: 'Cota reforçada', tags: ['mail'], classIds: ['warrior'], armor: 4 },

  // --- Acessórios (um equipado, escolhido antes da partida) ---
  { kind: 'accessory', id: 'accessory.vitality_amulet', version: 1, name: 'Amuleto da vitalidade', tags: ['hp'], maxHpBonus: 8 },
  { kind: 'accessory', id: 'accessory.ash_medallion', version: 1, name: 'Medalhão das cinzas', tags: ['FIRE', 'resistance'], resistances: { fire: 2 } },
  { kind: 'accessory', id: 'accessory.frost_medallion', version: 1, name: 'Medalhão da geada', tags: ['COLD', 'resistance'], resistances: { cold: 2 } },

  // --- Consumíveis (temporários da partida) ---
  {
    kind: 'consumable', id: 'consumable.health_potion', version: 1, name: 'Poção de vida', tags: ['HEAL', 'SELF'],
    cost: { ap: 1 }, target: { kind: 'self' },
    effects: [{ op: 'heal', selector: 'self', amount: '4d6+8' }],
  },
  {
    kind: 'consumable', id: 'consumable.focus_potion', version: 1, name: 'Poção de Foco', tags: ['FOCUS', 'SELF'],
    cost: { ap: 1 }, target: { kind: 'self' },
    effects: [{ op: 'restoreResource', selector: 'self', resource: 'focus', amount: '1d4+1' }],
  },
  {
    kind: 'consumable', id: 'consumable.oil_flask', version: 1, name: 'Frasco de óleo', tags: ['OIL', 'SURFACE', 'AREA'],
    cost: { ap: 1 }, target: { kind: 'cell', range: 4, requiresLineOfSight: true },
    effects: [{ op: 'createSurface', selector: 'crossArea', surface: 'oil', durationRounds: null }],
  },
];
