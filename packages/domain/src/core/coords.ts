import type { Coord } from './types.js';

export const coord = (x: number, y: number, floor = 0): Coord => ({ x, y, floor });

export const coordKey = (c: Coord): string => `${c.x},${c.y},${c.floor}`;

export const sameCoord = (a: Coord, b: Coord): boolean =>
  a.x === b.x && a.y === b.y && a.floor === b.floor;

/** Distância = |dx| + |dy| + 2 × |dAndar| (seção 2.3). */
export const distance = (a: Coord, b: Coord): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + 2 * Math.abs(a.floor - b.floor);

/** Vizinhos ortogonais no mesmo andar, em ordem fixa (determinismo). */
export const orthogonalNeighbors = (c: Coord): Coord[] => [
  { x: c.x, y: c.y - 1, floor: c.floor },
  { x: c.x + 1, y: c.y, floor: c.floor },
  { x: c.x, y: c.y + 1, floor: c.floor },
  { x: c.x - 1, y: c.y, floor: c.floor },
];

/** Célula central + quatro vizinhas (formato em cruz). */
export const crossArea = (c: Coord): Coord[] => [c, ...orthogonalNeighbors(c)];

/** Quadrado 3×3 no mesmo andar (raio lógico 1). */
export const squareArea = (c: Coord, radius = 1): Coord[] => {
  const out: Coord[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ x: c.x + dx, y: c.y + dy, floor: c.floor });
    }
  }
  return out;
};

export const formatCoord = (c: Coord): string => `(${c.x},${c.y},${c.floor})`;
