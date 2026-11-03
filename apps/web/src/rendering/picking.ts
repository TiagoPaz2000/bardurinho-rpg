/**
 * Picking (seção 14.5): ponto da tela → raycast da câmera → entidade ou célula lógica.
 *
 * - Só contam malhas selecionáveis e visíveis: as estruturas acima do andar visualizado
 *   ficam translúcidas e com `isPickable = false` (FloorView), então o raio as atravessa.
 * - Overlays (destaques, superfícies, grade, disco da equipe) não têm metadados de
 *   terreno nem de entidade e são ignorados.
 * - Entidade: sobe pelos pais até achar `metadata.entityId` (raiz do personagem/objeto).
 * - Terreno: a célula vem de `worldToCell` sobre o ponto atingido, recuado 1 cm para
 *   dentro da malha (as faces laterais ficam na fronteira entre duas células). O andar
 *   vem dos metadados da malha (pisos e lajes são mesclados por andar), não da altura.
 *
 * Puramente visual: o resultado é só uma intenção — o core valida o comando.
 */
import type { AbstractMesh, Node, Scene } from '@babylonjs/core';
import { getCell, type Coord, type EntityId, type GameMap } from '@bardurinho/domain';
import { FLOOR_HEIGHT, worldToCell } from './grid.js';
import type { TerrainPickInfo } from './terrain.js';

export type PickResult =
  | { kind: 'entity'; entityId: EntityId; entity: 'unit' | 'object'; mesh: AbstractMesh }
  | { kind: 'cell'; cell: Coord; terrain: TerrainPickInfo['terrain']; mesh: AbstractMesh };

/** Visibilidade mínima para uma malha bloquear o raio (fantasmas ficam em 0,12). */
const MIN_VISIBILITY = 0.5;

function entityOf(node: Node | null): { entityId: EntityId; entity: 'unit' | 'object' } | null {
  for (let n: Node | null = node; n; n = n.parent) {
    const md = n.metadata as { entityId?: EntityId; entity?: 'unit' | 'object' } | null | undefined;
    if (md?.entityId && (md.entity === 'unit' || md.entity === 'object')) return { entityId: md.entityId, entity: md.entity };
  }
  return null;
}

const terrainOf = (mesh: AbstractMesh): TerrainPickInfo | null => {
  const md = mesh.metadata as Partial<TerrainPickInfo> | null | undefined;
  return md?.terrain !== undefined && md.floor !== undefined ? (md as TerrainPickInfo) : null;
};

function isCandidate(mesh: AbstractMesh): boolean {
  if (!mesh.isPickable || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility < MIN_VISIBILITY) return false;
  return terrainOf(mesh) !== null || entityOf(mesh) !== null;
}

/** Raycast a partir de um ponto do canvas (pixels CSS, relativos ao canvas). */
export function pickAt(scene: Scene, map: GameMap, x: number, y: number): PickResult | null {
  const hit = scene.pick(x, y, isCandidate);
  if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return null;
  const mesh = hit.pickedMesh;
  const ent = entityOf(mesh);
  if (ent) return { kind: 'entity', ...ent, mesh };

  const terrain = terrainOf(mesh);
  if (!terrain) return null;
  const p = hit.pickedPoint.clone();
  const n = hit.getNormal(true, true);
  if (n) p.subtractInPlace(n.scale(0.01));
  let floor = terrain.floor;
  if (terrain.terrain === 'walls') {
    // Pilares sob as lajes estão na malha de paredes do andar de cima: usa a altura.
    floor = Math.max(0, Math.min(terrain.floor, Math.floor((p.y + 0.05) / FLOOR_HEIGHT)));
  }
  const cell = worldToCell({ x: p.x, y: p.y, z: p.z }, map, floor);
  if (!cell || !getCell(map, cell)) return null;
  return { kind: 'cell', cell, terrain: terrain.terrain, mesh };
}
