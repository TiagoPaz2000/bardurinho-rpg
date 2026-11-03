/**
 * URLs dos ícones (Fase 4) a partir do manifesto de assets. A pasta `assets/` é servida na
 * raiz do cliente (`publicDir`), então o caminho do manifesto vira `/<caminho>`.
 */
import { abilityIconPath, actionIconPath, assetUrl, classIconPath, itemIconPath, statusIconPath } from '@bardurinho/assets-manifest';

const url = (path: string | undefined) => (path ? assetUrl(path) : undefined);

export const abilityIcon = (abilityId: string) => url(abilityIconPath(abilityId));
export const itemIcon = (itemId: string) => url(itemIconPath(itemId));
export const statusIcon = (statusId: string) => url(statusIconPath(statusId));
export const classIcon = (classId: string) => url(classIconPath(classId));
export const actionIcon = (action: string) => url(actionIconPath(action));

/** Ícone de uma carta da barra de ações / botão (`ActionInfo.kind` + `id`). */
export function iconForAction(kind: string, id: string): string | undefined {
  switch (kind) {
    case 'ability':
      return abilityIcon(id);
    case 'attack':
    case 'item':
      return itemIcon(id) ?? actionIcon(kind === 'item' ? 'use_item' : 'attack');
    case 'move':
      return actionIcon('move');
    case 'defend':
      return actionIcon('defend');
    case 'endTurn':
      return actionIcon('end_turn');
    case 'interact':
      return actionIcon('interact');
    default:
      return undefined;
  }
}

/** `<img>` pronto para o HTML (vazio se não houver ícone). */
export function iconImg(src: string | undefined, cls = 'icon', alt = ''): string {
  return src ? `<img class="${cls}" src="${src}" alt="${alt.replace(/"/g, '&quot;')}" draggable="false">` : '';
}
