import { sameCoord } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import type { Catalog } from '../rules/definitions.js';
import { objectBlocksVision, objectsAt } from '../state/queries.js';
import type { GameState } from '../state/types.js';
import { getCell } from './grid.js';

export type LineOfSightBlock = 'WALL_BLOCK' | 'OBJECT_BLOCK' | 'OUT_OF_BOUNDS';

export interface LineOfSightResult {
  visible: boolean;
  reason?: LineOfSightBlock;
  blockedAt?: Coord;
  /** Células atravessadas, excluindo origem e destino. */
  path: Array<{ x: number; y: number }>;
}

/**
 * Células 2D atravessadas por um segmento entre centros de células (supercover).
 * Quando a linha passa exatamente por um canto, ambas as células laterais são incluídas.
 */
export function supercoverLine(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const points = [{ x: x0, y: y0 }];
  let x = x0;
  let y = y0;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      // Canto exato: inclui as duas células laterais.
      points.push({ x: x + sx, y });
      points.push({ x, y: y + sy });
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    points.push({ x, y });
  }
  return points;
}

/**
 * Linha de visão lógica.
 *
 * MVP: paredes e objetos que bloqueiam visão impedem a linha. Entre andares, a linha
 * é verificada no andar de origem e no de destino (aproximação provisória até o mapa
 * final definir bordas de plataforma e guarda-corpos).
 * Unidades não bloqueiam linha de visão.
 */
export function lineOfSight(state: GameState, catalog: Catalog, from: Coord, to: Coord): LineOfSightResult {
  if (!getCell(state.map, from) || !getCell(state.map, to)) {
    return { visible: false, reason: 'OUT_OF_BOUNDS', path: [] };
  }
  const line = supercoverLine(from.x, from.y, to.x, to.y).filter(
    (p) => !(p.x === from.x && p.y === from.y) && !(p.x === to.x && p.y === to.y),
  );
  const floors = from.floor === to.floor ? [from.floor] : [from.floor, to.floor];
  for (const p of line) {
    for (const floor of floors) {
      const c = { x: p.x, y: p.y, floor };
      const cell = getCell(state.map, c);
      if (!cell) return { visible: false, reason: 'OUT_OF_BOUNDS', blockedAt: c, path: line };
      if (cell.terrain === 'wall') return { visible: false, reason: 'WALL_BLOCK', blockedAt: c, path: line };
      if (objectsAt(state, c).some((o) => objectBlocksVision(catalog, o))) {
        return { visible: false, reason: 'OBJECT_BLOCK', blockedAt: c, path: line };
      }
    }
  }
  return { visible: true, path: line };
}

export const hasLineOfSight = (state: GameState, catalog: Catalog, from: Coord, to: Coord): boolean =>
  sameCoord(from, to) || lineOfSight(state, catalog, from, to).visible;
