import { sameCoord, squareArea } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import type { Catalog } from '../rules/definitions.js';
import { objectBlocksVision, objectsAt } from '../state/queries.js';
import type { GameState } from '../state/types.js';
import { getCell } from './grid.js';

export type LineOfSightBlock = 'WALL_BLOCK' | 'OBJECT_BLOCK' | 'FLOOR_BLOCK' | 'OUT_OF_BOUNDS';

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
 * Linha de visão lógica. Unidades não bloqueiam linha de visão.
 *
 * Mesmo andar: paredes e objetos que bloqueiam visão impedem a linha.
 *
 * Entre andares (seção 2.3: "considerarão a diferença de altura"): a linha vai da altura
 * do corpo na origem (andar + 0,5) à do destino. Em cada célula atravessada, verifica-se
 * parede/objeto no andar em que a linha está naquele ponto. Ao passar de um nível para
 * outro, a linha precisa atravessar uma célula vazia (`void`) do andar superior — chão de
 * plataforma ou parede ali funcionam como laje e bloqueiam (`FLOOR_BLOCK`). Na borda exata
 * entre duas células, basta uma delas estar livre (quem está na beira enxerga abaixo).
 */
export function lineOfSight(state: GameState, catalog: Catalog, from: Coord, to: Coord): LineOfSightResult {
  if (!getCell(state.map, from) || !getCell(state.map, to)) {
    return { visible: false, reason: 'OUT_OF_BOUNDS', path: [] };
  }
  const line = supercoverLine(from.x, from.y, to.x, to.y).filter(
    (p) => !(p.x === from.x && p.y === from.y) && !(p.x === to.x && p.y === to.y),
  );
  const blockAt = (c: Coord): LineOfSightResult | null => {
    const cell = getCell(state.map, c);
    if (!cell) return { visible: false, reason: 'OUT_OF_BOUNDS', blockedAt: c, path: line };
    if (cell.terrain === 'wall') return { visible: false, reason: 'WALL_BLOCK', blockedAt: c, path: line };
    if (objectsAt(state, c).some((o) => objectBlocksVision(catalog, o))) {
      return { visible: false, reason: 'OBJECT_BLOCK', blockedAt: c, path: line };
    }
    return null;
  };

  if (from.floor === to.floor) {
    for (const p of line) {
      const b = blockAt({ x: p.x, y: p.y, floor: from.floor });
      if (b) return b;
    }
    return { visible: true, path: line };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  const za = from.floor + 0.5;
  const zb = to.floor + 0.5;
  const heightAt = (t: number) => za + (zb - za) * t;
  const tOf = (p: { x: number; y: number }) => (len2 === 0 ? 0.5 : ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2);

  // 1) Paredes/objetos no andar em que a linha está em cada célula intermediária.
  for (const p of line) {
    const floor = Math.min(state.map.floors - 1, Math.max(0, Math.floor(heightAt(tOf(p)))));
    const b = blockAt({ x: p.x, y: p.y, floor });
    if (b) return b;
  }

  // 2) Lajes: cada nível atravessado precisa de uma célula vazia no ponto de passagem.
  const low = Math.min(from.floor, to.floor);
  const high = Math.max(from.floor, to.floor);
  for (let level = low + 1; level <= high; level++) {
    const t = (level - za) / (zb - za);
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const xs = candidates(px);
    const ys = candidates(py);
    let open = false;
    let blocked: Coord | undefined;
    for (const x of xs) {
      for (const y of ys) {
        const c = { x, y, floor: level };
        const cell = getCell(state.map, c);
        if (cell && cell.terrain === 'void') open = true;
        else blocked ??= c;
      }
    }
    if (!open) return { visible: false, reason: 'FLOOR_BLOCK', ...(blocked ? { blockedAt: blocked } : {}), path: line };
  }
  return { visible: true, path: line };
}

/** Células cujo intervalo contém a coordenada; na borda exata (x,5), as duas. */
function candidates(v: number): number[] {
  const frac = v - Math.floor(v);
  if (Math.abs(frac - 0.5) < 1e-9) return [Math.floor(v), Math.ceil(v)];
  return [Math.round(v)];
}

export const hasLineOfSight = (state: GameState, catalog: Catalog, from: Coord, to: Coord): boolean =>
  sameCoord(from, to) || lineOfSight(state, catalog, from, to).visible;

/**
 * Área de explosão: quadrado de raio lógico `radius` no andar do centro, só células que não
 * são parede e têm linha de visão a partir do centro (paredes e portas fechadas protegem).
 * Usada pelos barris explosivos e pela Bola de fogo.
 */
export const blastArea = (state: GameState, catalog: Catalog, center: Coord, radius = 1): Coord[] =>
  squareArea(center, radius).filter((c) => {
    const cell = getCell(state.map, c);
    return !!cell && cell.terrain !== 'wall' && hasLineOfSight(state, catalog, center, c);
  });
