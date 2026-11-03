/**
 * Conversão entre a grade lógica (x, y, floor) do core e o mundo 3D do Babylon.
 *
 * Convenção (cena em sistema destro, `scene.useRightHandedSystem = true`, igual ao glTF):
 * - 1 unidade = 1 metro; cada célula mede 2 × 2 m (seção 6).
 * - Mundo X = x · 2 + 1  → centro da célula no eixo X.
 * - Mundo Z = y · 2 + 1  → a linha `y` do mapa cresce em +Z.
 * - Mundo Y = floor · 4  → o andar 1 fica 4 m acima do térreo; Y é a face superior do piso.
 * - A célula (x, y) ocupa X ∈ [2x, 2x + 2) e Z ∈ [2y, 2y + 2); a arena vai de (0, 0) a (2·width, 2·height).
 *
 * A câmera inicial olha a partir de +Z para −Z, então a tela mostra a mesma orientação
 * do visualizador 2D do Combat Debug Lab: x cresce para a direita, linha 0 no fundo (topo).
 *
 * Este módulo é puramente visual: a posição oficial é sempre a coordenada lógica do core.
 */
import type { Coord, GameMap } from '@bardurinho/domain';

export const CELL_SIZE = 2;
export const FLOOR_HEIGHT = 4;

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** Centro da face superior da célula, em metros. */
export function cellToWorld(c: Coord): WorldPoint {
  return {
    x: c.x * CELL_SIZE + CELL_SIZE / 2,
    y: c.floor * FLOOR_HEIGHT,
    z: c.y * CELL_SIZE + CELL_SIZE / 2,
  };
}

/** Altura (Y) da face superior de um andar. */
export const floorToWorldY = (floor: number): number => floor * FLOOR_HEIGHT;

/**
 * Converte um ponto do mundo na célula que o contém.
 * O andar é o mais próximo da altura do ponto (um ponto de um raycast sobre o piso do
 * andar 1 tem Y ≈ 4). Passe `floor` para forçar o andar (ex.: picking num plano conhecido).
 * Com `map`, retorna `null` fora dos limites.
 */
export function worldToCell(p: WorldPoint, map?: GameMap, floor?: number): Coord | null {
  const c: Coord = {
    x: Math.floor(p.x / CELL_SIZE),
    y: Math.floor(p.z / CELL_SIZE),
    floor: floor ?? Math.max(0, Math.round(p.y / FLOOR_HEIGHT)),
  };
  if (map && (c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height || c.floor < 0 || c.floor >= map.floors)) {
    return null;
  }
  return c;
}

/** Limites da arena no plano XZ, em metros. */
export function arenaBounds(map: GameMap): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return { minX: 0, maxX: map.width * CELL_SIZE, minZ: 0, maxZ: map.height * CELL_SIZE };
}
