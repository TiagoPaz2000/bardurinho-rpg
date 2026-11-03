/**
 * Manifesto de assets (seção 9 do plano): liga ids de apresentação a arquivos.
 *
 * Os caminhos são relativos à pasta `assets/` da raiz do repositório, que o
 * Combat Debug Lab serve como `publicDir` — ou seja, `assetUrl(path)` = `/${path}`.
 *
 * Convenção de pastas:
 *   assets/icons/<categoria>/master/<nome>.png  — imagem-mestre original (1254×1254)
 *   assets/icons/<categoria>/<nome>.png         — versão web 256×256 (gerada por `npm run icons`)
 *   assets/icons/<categoria>/<nome>.svg         — ícones vetoriais 256×256 (gerados por `npm run icons:svg`)
 *
 * Ver docs/icones.md.
 */

/** iconId → caminho (relativo a `assets/`) do ícone. */
export const icons = {
  // Armas (PNG, arte-mestre)
  'icon.weapon.iron_sword': 'icons/items/weapon.iron_sword.png',
  'icon.weapon.dagger': 'icons/items/weapon.dagger.png',
  'icon.weapon.short_bow': 'icons/items/weapon.short_bow.png',
  'icon.weapon.arcane_wand': 'icons/items/weapon.arcane_wand.png',
  'icon.weapon.nature_staff': 'icons/items/weapon.nature_staff.png',
  /** Flecha com ponta de cristal — ainda sem item correspondente (munição? VFX `trail.arrow`?). */
  'icon.unassigned.arrow': 'icons/unassigned/arrow.png',

  // Itens não-arma (SVG)
  'icon.item.armor.tunic': 'icons/items/armor.tunic.svg',
  'icon.item.armor.leather': 'icons/items/armor.leather.svg',
  'icon.item.armor.reinforced_mail': 'icons/items/armor.reinforced_mail.svg',
  'icon.item.accessory.vitality_amulet': 'icons/items/accessory.vitality_amulet.svg',
  'icon.item.accessory.ash_medallion': 'icons/items/accessory.ash_medallion.svg',
  'icon.item.accessory.frost_medallion': 'icons/items/accessory.frost_medallion.svg',
  'icon.item.consumable.health_potion': 'icons/items/consumable.health_potion.svg',
  'icon.item.consumable.focus_potion': 'icons/items/consumable.focus_potion.svg',
  'icon.item.consumable.oil_flask': 'icons/items/consumable.oil_flask.svg',

  // Habilidades (= `presentation.iconId` no catálogo de conteúdo)
  'icon.flame': 'icons/abilities/flame.svg',
  'icon.frost_ray': 'icons/abilities/frost_ray.svg',
  'icon.arcane_barrier': 'icons/abilities/arcane_barrier.svg',
  'icon.precise_shot': 'icons/abilities/precise_shot.svg',
  'icon.hide': 'icons/abilities/hide.svg',
  'icon.charge': 'icons/abilities/charge.svg',
  'icon.push': 'icons/abilities/push.svg',
  'icon.thorns': 'icons/abilities/thorns.svg',
  'icon.natural_heal': 'icons/abilities/natural_heal.svg',
  'icon.root': 'icons/abilities/root.svg',

  // Estados (medalhas redondas)
  'icon.status.burning': 'icons/statuses/burning.svg',
  'icon.status.slowed': 'icons/statuses/slowed.svg',
  'icon.status.rooted': 'icons/statuses/rooted.svg',
  'icon.status.hidden': 'icons/statuses/hidden.svg',
  /** A Barreira é `Unit.shield`, não um StatusDefinition — mas aparece na barra de estados. */
  'icon.status.barrier': 'icons/statuses/barrier.svg',

  // Classes (estandartes)
  'icon.class.mage': 'icons/classes/mage.svg',
  'icon.class.rogue': 'icons/classes/rogue.svg',
  'icon.class.warrior': 'icons/classes/warrior.svg',
  'icon.class.druid': 'icons/classes/druid.svg',

  // Ações da interface
  'icon.action.move': 'icons/actions/move.svg',
  'icon.action.attack': 'icons/actions/attack.svg',
  'icon.action.defend': 'icons/actions/defend.svg',
  'icon.action.interact': 'icons/actions/interact.svg',
  'icon.action.use_item': 'icons/actions/use_item.svg',
  'icon.action.end_turn': 'icons/actions/end_turn.svg',
  'icon.action.cooldown': 'icons/actions/cooldown.svg',
  'icon.action.dice': 'icons/actions/dice.svg',
} as const satisfies Record<string, string>;

export type IconId = keyof typeof icons;

/**
 * itemId → iconId. Fonte de verdade para itens cujo tipo de definição não tem
 * `presentation` (armaduras, acessórios e consumíveis); as armas também declaram
 * o mesmo `presentation.iconId` no catálogo de conteúdo.
 */
export const itemIcons: Readonly<Record<string, IconId>> = {
  'weapon.iron_sword': 'icon.weapon.iron_sword',
  'weapon.dagger': 'icon.weapon.dagger',
  'weapon.short_bow': 'icon.weapon.short_bow',
  'weapon.arcane_wand': 'icon.weapon.arcane_wand',
  'weapon.nature_staff': 'icon.weapon.nature_staff',
  'armor.tunic': 'icon.item.armor.tunic',
  'armor.leather': 'icon.item.armor.leather',
  'armor.reinforced_mail': 'icon.item.armor.reinforced_mail',
  'accessory.vitality_amulet': 'icon.item.accessory.vitality_amulet',
  'accessory.ash_medallion': 'icon.item.accessory.ash_medallion',
  'accessory.frost_medallion': 'icon.item.accessory.frost_medallion',
  'consumable.health_potion': 'icon.item.consumable.health_potion',
  'consumable.focus_potion': 'icon.item.consumable.focus_potion',
  'consumable.oil_flask': 'icon.item.consumable.oil_flask',
};

/** Ações da interface de combate com ícone próprio. */
export type ActionIcon = 'move' | 'attack' | 'defend' | 'interact' | 'use_item' | 'end_turn' | 'cooldown' | 'dice';

export function isIconId(id: string): id is IconId {
  return Object.prototype.hasOwnProperty.call(icons, id);
}

/** Caminho (relativo a `assets/`) do ícone, ou `undefined` se não houver arte. */
export function iconPath(iconId: string): string | undefined {
  return isIconId(iconId) ? icons[iconId] : undefined;
}

/** Caminho (relativo a `assets/`) do ícone de um item, ou `undefined` se ainda não houver arte. */
export function itemIconPath(itemId: string): string | undefined {
  const iconId = itemIcons[itemId];
  return iconId ? icons[iconId] : undefined;
}

/**
 * Caminho do ícone de uma habilidade pelo id (`'mage.flame'`). Usa a parte após
 * o prefixo da classe, que coincide com `presentation.iconId` (`icon.flame`).
 * Aceita também o próprio iconId (`'icon.flame'`).
 */
export function abilityIconPath(abilityId: string): string | undefined {
  if (abilityId.startsWith('icon.')) return iconPath(abilityId);
  return iconPath(`icon.${abilityId.slice(abilityId.indexOf('.') + 1)}`);
}

/** Caminho do ícone de um estado (`'burning'`, `'slowed'`, `'rooted'`, `'hidden'`, `'barrier'`). */
export function statusIconPath(statusId: string): string | undefined {
  return iconPath(`icon.status.${statusId}`);
}

/** Caminho do ícone de uma classe (`'mage'`, `'rogue'`, `'warrior'`, `'druid'`). */
export function classIconPath(classId: string): string | undefined {
  return iconPath(`icon.class.${classId}`);
}

/** Caminho do ícone de uma ação da interface. */
export function actionIconPath(action: ActionIcon | (string & {})): string | undefined {
  return iconPath(`icon.action.${action}`);
}

/** URL servida pelo Debug Lab (publicDir = `assets/`). */
export function assetUrl(path: string, base = '/'): string {
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}
