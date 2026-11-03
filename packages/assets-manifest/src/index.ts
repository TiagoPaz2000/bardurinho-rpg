/**
 * Manifesto de assets (seção 9 do plano): liga ids de apresentação a arquivos.
 *
 * Os caminhos são relativos à pasta `assets/` da raiz do repositório, que o
 * Combat Debug Lab serve como `publicDir` — ou seja, `assetUrl(path)` = `/${path}`.
 *
 * Convenção de pastas:
 *   assets/icons/<categoria>/master/<nome>.png  — imagem-mestre original (1254×1254)
 *   assets/icons/<categoria>/<nome>.png         — versão web 256×256 (gerada por `npm run icons`)
 */

/** iconId → caminho (relativo a `assets/`) da versão web 256×256. */
export const icons = {
  'icon.weapon.iron_sword': 'icons/items/weapon.iron_sword.png',
  'icon.weapon.dagger': 'icons/items/weapon.dagger.png',
  'icon.weapon.short_bow': 'icons/items/weapon.short_bow.png',
  'icon.weapon.arcane_wand': 'icons/items/weapon.arcane_wand.png',
  'icon.weapon.nature_staff': 'icons/items/weapon.nature_staff.png',
  /** Flecha com ponta de cristal — ainda sem item correspondente (munição? VFX `trail.arrow`?). */
  'icon.unassigned.arrow': 'icons/unassigned/arrow.png',
} as const satisfies Record<string, string>;

export type IconId = keyof typeof icons;

/**
 * itemId → iconId. Fonte de verdade para itens cujo tipo de definição não tem
 * `presentation` (armaduras e acessórios); as armas também declaram o mesmo
 * `presentation.iconId` no catálogo de conteúdo.
 */
export const itemIcons: Readonly<Record<string, IconId>> = {
  'weapon.iron_sword': 'icon.weapon.iron_sword',
  'weapon.dagger': 'icon.weapon.dagger',
  'weapon.short_bow': 'icon.weapon.short_bow',
  'weapon.arcane_wand': 'icon.weapon.arcane_wand',
  'weapon.nature_staff': 'icon.weapon.nature_staff',
};

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

/** URL servida pelo Debug Lab (publicDir = `assets/`). */
export function assetUrl(path: string, base = '/'): string {
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}
