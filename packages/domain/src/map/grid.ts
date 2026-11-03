import type { Coord, EntityId } from '../core/types.js';

export type Terrain = 'ground' | 'wall' | 'void';
export type SurfaceKind = 'oil' | 'fire' | 'thorns';

export interface SurfaceInstance {
  kind: SurfaceKind;
  createdRound: number;
  /** Rodada em cujo início a superfície expira. `null` = permanente. */
  expiresAtRound: number | null;
  sourceId: EntityId | null;
  /** Definição (habilidade, item, reação) que criou a superfície. */
  sourceDefinitionId: string | null;
}

export interface Cell {
  terrain: Terrain;
  surface: SurfaceInstance | null;
  /** Área escura (alcova): detecção reduzida. */
  dark: boolean;
}

/** Conexão explícita entre andares (escada). */
export interface FloorConnection {
  a: Coord;
  b: Coord;
  cost: number;
}

export interface GameMap {
  width: number;
  height: number;
  floors: number;
  /** cells[floor][y * width + x] */
  cells: Cell[][];
  connections: FloorConnection[];
}

export const inBounds = (map: GameMap, c: Coord): boolean =>
  c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height && c.floor >= 0 && c.floor < map.floors;

export const getCell = (map: GameMap, c: Coord): Cell | undefined =>
  inBounds(map, c) ? map.cells[c.floor]?.[c.y * map.width + c.x] : undefined;

export const allCoords = (map: GameMap): Coord[] => {
  const out: Coord[] = [];
  for (let floor = 0; floor < map.floors; floor++)
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) out.push({ x, y, floor });
  return out;
};

const TERRAIN_CHARS: Record<string, Terrain> = {
  '.': 'ground',
  '#': 'wall',
  '_': 'void',
  ' ': 'void',
  'd': 'ground', // chão escuro
};

/**
 * Cria um mapa a partir de linhas ASCII, uma lista por andar.
 * `.` chão, `#` parede, `_` vazio, `d` chão em área escura.
 */
export function createMapFromAscii(floors: string[][], connections: FloorConnection[] = []): GameMap {
  const height = Math.max(...floors.map((f) => f.length));
  const width = Math.max(...floors.flatMap((f) => f.map((row) => row.length)));
  const cells: Cell[][] = floors.map((rows) => {
    const floorCells: Cell[] = [];
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < width; x++) {
        const ch = row[x] ?? '_';
        const terrain = TERRAIN_CHARS[ch];
        if (!terrain) throw new Error(`Caractere de terreno desconhecido '${ch}' em (${x},${y})`);
        floorCells.push({ terrain, surface: null, dark: ch === 'd' });
      }
    }
    return floorCells;
  });
  return { width, height, floors: floors.length, cells, connections };
}

export function createEmptyMap(width: number, height: number, floors = 1): GameMap {
  const row = '.'.repeat(width);
  return createMapFromAscii(Array.from({ length: floors }, () => Array.from({ length: height }, () => row)));
}

export function mapToAscii(map: GameMap): string[][] {
  const out: string[][] = [];
  for (let floor = 0; floor < map.floors; floor++) {
    const rows: string[] = [];
    for (let y = 0; y < map.height; y++) {
      let row = '';
      for (let x = 0; x < map.width; x++) {
        const cell = getCell(map, { x, y, floor })!;
        row += cell.terrain === 'wall' ? '#' : cell.terrain === 'void' ? '_' : cell.dark ? 'd' : '.';
      }
      rows.push(row);
    }
    out.push(rows);
  }
  return out;
}
