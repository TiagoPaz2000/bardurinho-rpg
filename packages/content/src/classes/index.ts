import type { ClassDefinition } from '@bardurinho/domain';

/** Classes (seção 2.1). A armadura vem do equipamento inicial. */
export const classes: ClassDefinition[] = [
  {
    kind: 'class', id: 'mage', version: 3, name: 'Mago', tags: ['caster'],
    hp: 86, ap: 2, mp: 5, maxFocus: 10, defense: 11, attackBonus: 5,
    loadout: {
      weapons: ['weapon.arcane_wand'],
      armor: 'armor.tunic',
      abilities: ['mage.flame', 'mage.fireball', 'mage.frost_ray', 'mage.arcane_barrier'],
    },
  },
  {
    kind: 'class', id: 'rogue', version: 1, name: 'Ladino', tags: ['skirmisher'],
    hp: 90, ap: 2, mp: 6, maxFocus: 8, defense: 13, attackBonus: 6,
    loadout: {
      weapons: ['weapon.dagger', 'weapon.short_bow'],
      armor: 'armor.leather',
      abilities: ['rogue.precise_shot', 'rogue.hide'],
    },
  },
  {
    kind: 'class', id: 'warrior', version: 1, name: 'Guerreiro', tags: ['melee'],
    hp: 110, ap: 2, mp: 5, maxFocus: 8, defense: 14, attackBonus: 5,
    loadout: {
      weapons: ['weapon.iron_sword'],
      armor: 'armor.reinforced_mail',
      abilities: ['warrior.charge', 'warrior.push'],
    },
  },
  {
    kind: 'class', id: 'druid', version: 1, name: 'Druida', tags: ['caster', 'support'],
    hp: 95, ap: 2, mp: 5, maxFocus: 10, defense: 12, attackBonus: 5,
    loadout: {
      weapons: ['weapon.nature_staff'],
      armor: 'armor.leather',
      abilities: ['druid.thorns', 'druid.natural_heal', 'druid.root'],
    },
  },
];
