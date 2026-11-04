/**
 * Fase 5: retrato do personagem (emblema + fundo + moldura), desenhado em SVG a partir dos
 * cosméticos equipados (`portrait`, `frame`) — sem arquivos de imagem novos.
 */
import { DEFAULT_APPEARANCE, cosmeticsById } from '@bardurinho/content';
import { classIcon } from '../icons.js';

const EMBLEMS: Record<string, string> = {
  // Coroa sobre juba
  lion: '<path d="M14 24 L18 14 L24 20 L30 12 L36 20 L42 14 L46 24 Z" fill="#ffd43b"/><circle cx="30" cy="36" r="12" fill="#e8a33a"/><circle cx="26" cy="34" r="1.8" fill="#3b2a12"/><circle cx="34" cy="34" r="1.8" fill="#3b2a12"/><path d="M26 41 Q30 44 34 41" stroke="#3b2a12" stroke-width="2" fill="none"/>',
  // Asas e bico
  raven: '<path d="M8 34 Q20 18 30 30 Q40 18 52 34 Q40 30 30 40 Q20 30 8 34 Z" fill="#d0d6e6"/><path d="M27 30 L30 22 L33 30 Z" fill="#ffd43b"/>',
  // Chama
  flame: '<path d="M30 10 C38 22 44 28 40 40 C38 48 22 48 20 40 C17 30 26 26 26 18 C30 24 30 28 34 30 C35 24 32 16 30 10 Z" fill="#ff922b"/><path d="M30 26 C34 32 36 36 34 41 C32 45 27 45 26 41 C25 37 29 34 30 26 Z" fill="#ffe066"/>',
  // Árvore
  tree: '<circle cx="30" cy="24" r="13" fill="#69db7c"/><circle cx="22" cy="30" r="8" fill="#51cf66"/><circle cx="38" cy="30" r="8" fill="#51cf66"/><rect x="27" y="32" width="6" height="16" fill="#8a5a32"/>',
};

/** HTML do retrato (`size` em px). */
export function portraitHtml(classId: string, appearance: Record<string, string> | null | undefined, size = 56): string {
  const a = { ...DEFAULT_APPEARANCE, ...(appearance ?? {}) };
  const p = cosmeticsById[a.portrait]?.presentation ?? {};
  const border = cosmeticsById[a.frame]?.presentation.border ?? '#495057';
  const tint = cosmeticsById[a.color]?.presentation.tint;
  const bg = p.background ?? '#2b2f36';
  const glow = a.frame === 'frame.gold' ? `box-shadow:0 0 8px ${border};` : '';
  const inner =
    !p.emblem || p.emblem === 'class'
      ? `<img src="${classIcon(classId) ?? ''}" alt="" style="width:72%;height:72%" draggable="false">`
      : `<svg viewBox="0 0 60 60" style="width:86%;height:86%">${EMBLEMS[p.emblem] ?? ''}</svg>`;
  return `<span class="portrait" data-portrait="${a.portrait}" data-frame="${a.frame}" style="width:${size}px;height:${size}px;background:${bg};border:3px solid ${border};${glow}">${inner}${tint ? `<i class="portrait-color" style="background:${tint}"></i>` : ''}</span>`;
}
