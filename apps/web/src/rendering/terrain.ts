/**
 * Geometria estática do mapa, construída só a partir de `GameMap` (terreno, áreas escuras,
 * conexões entre andares). Nada aqui decide regras: a malha é decorativa e o grid lógico
 * continua invisível.
 */
import { Color3, Color4, Mesh, MeshBuilder, TransformNode, type Scene } from '@babylonjs/core';
import { getCell, type Coord, type GameMap } from '@bardurinho/domain';
import { CELL_SIZE, FLOOR_HEIGHT, cellToWorld, floorToWorldY } from './grid.js';
import { PALETTE, type Materials } from './materials.js';

const GROUND_THICKNESS = 0.3;
const SLAB_THICKNESS = 0.4;
const WALL_HEIGHT = 3;
const RAIL_HEIGHT = 0.9;
const STAIR_STEPS = 8;

export interface TerrainBuild {
  /** Nós por andar (para o FloorView). */
  byFloor: Array<{ node: TransformNode; floor: number }>;
  /** Malhas que projetam sombra. */
  casters: Mesh[];
  /** Malhas que recebem sombra. */
  receivers: Mesh[];
}

const isGround = (map: GameMap, c: Coord) => getCell(map, c)?.terrain === 'ground';

/** Pequena variação de tom por placa (determinística) para o piso não parecer chapado. */
function jitter(hex: string, x: number, y: number, floor: number): Color4 {
  const h = Math.sin(x * 12.9898 + y * 78.233 + floor * 37.719) * 43758.5453;
  const t = (h - Math.floor(h) - 0.5) * 0.08;
  const c = Color3.FromHexString(hex);
  return new Color4(c.r * (1 + t), c.g * (1 + t), c.b * (1 + t), 1);
}

function merge(parts: Mesh[], name: string): Mesh | null {
  if (parts.length === 0) return null;
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (merged) merged.name = name;
  return merged;
}

export function buildTerrain(scene: Scene, map: GameMap, mats: Materials): TerrainBuild {
  const out: TerrainBuild = { byFloor: [], casters: [], receivers: [] };

  // Chão de fundo ao redor da arena (moldura visual, fora do grid).
  const margin = 10;
  const outside = MeshBuilder.CreateGround(
    'outside',
    { width: map.width * CELL_SIZE + margin * 2, height: map.height * CELL_SIZE + margin * 2 },
    scene,
  );
  outside.position.set((map.width * CELL_SIZE) / 2, -GROUND_THICKNESS - 0.01, (map.height * CELL_SIZE) / 2);
  outside.material = mats.solid(PALETTE.outside);
  outside.isPickable = false;
  outside.receiveShadows = true;
  out.receivers.push(outside);

  for (let floor = 0; floor < map.floors; floor++) {
    const root = new TransformNode(`terrain:floor${floor}`, scene);
    const tiles: Mesh[] = [];
    const walls: Mesh[] = [];
    const rails: Mesh[] = [];
    const baseY = floorToWorldY(floor);
    const thickness = floor === 0 ? GROUND_THICKNESS : SLAB_THICKNESS;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const c = { x, y, floor };
        const cell = getCell(map, c);
        if (!cell || cell.terrain === 'void') continue;
        const w = cellToWorld(c);
        if (cell.terrain === 'ground') {
          const hex = floor === 0 ? (cell.dark ? PALETTE.groundDark : PALETTE.ground) : cell.dark ? PALETTE.platformDark : PALETTE.platform;
          const col = jitter(hex, x, y, floor);
          const tile = MeshBuilder.CreateBox(`tile`, { width: CELL_SIZE, depth: CELL_SIZE, height: thickness, faceColors: Array(6).fill(col) }, scene);
          tile.position.set(w.x, baseY - thickness / 2, w.z);
          tiles.push(tile);
          if (floor > 0) rails.push(...buildRails(scene, map, c));
        } else {
          // Parede: sob uma plataforma, sobe até a laje (serve de apoio).
          const above = getCell(map, { x, y, floor: floor + 1 });
          const height = above?.terrain === 'ground' ? FLOOR_HEIGHT - SLAB_THICKNESS : WALL_HEIGHT;
          const wall = MeshBuilder.CreateBox('wall', { width: CELL_SIZE, depth: CELL_SIZE, height }, scene);
          wall.position.set(w.x, baseY + height / 2, w.z);
          walls.push(wall);
        }
      }
    }
    if (floor > 0) walls.push(...buildPillars(scene, map, floor));

    const tileMesh = merge(tiles, `tiles:floor${floor}`);
    if (tileMesh) {
      tileMesh.material = mats.vertexColored('tiles');
      tileMesh.receiveShadows = true;
      tileMesh.parent = root;
      out.receivers.push(tileMesh);
      if (floor > 0) out.casters.push(tileMesh);
    }
    const wallMesh = merge(walls, `walls:floor${floor}`);
    if (wallMesh) {
      wallMesh.material = mats.solid(PALETTE.wall);
      wallMesh.receiveShadows = true;
      wallMesh.parent = root;
      out.casters.push(wallMesh);
      out.receivers.push(wallMesh);
    }
    const railMesh = merge(rails, `rails:floor${floor}`);
    if (railMesh) {
      railMesh.material = mats.solid(PALETTE.rail);
      railMesh.parent = root;
      out.casters.push(railMesh);
    }
    out.byFloor.push({ node: root, floor });
  }

  // Escadas: pertencem ao andar de baixo (continuam visíveis ao olhar o térreo).
  const stairsRoot = new TransformNode('terrain:stairs', scene);
  const steps: Mesh[] = [];
  for (const conn of map.connections) steps.push(...buildStairs(scene, conn.a, conn.b));
  const stairMesh = merge(steps, 'stairs');
  if (stairMesh) {
    stairMesh.material = mats.solid(PALETTE.stairs);
    stairMesh.receiveShadows = true;
    stairMesh.parent = stairsRoot;
    out.casters.push(stairMesh);
    out.receivers.push(stairMesh);
  }
  out.byFloor.push({ node: stairsRoot, floor: 0 });

  for (const m of out.casters) m.metadata = { ...(m.metadata ?? {}), castsShadow: true };
  return out;
}

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** Guarda-corpo nas bordas da plataforma, exceto onde chega uma escada. */
function buildRails(scene: Scene, map: GameMap, c: Coord): Mesh[] {
  const out: Mesh[] = [];
  const w = cellToWorld(c);
  for (const { dx, dy } of DIRS) {
    const n = { x: c.x + dx, y: c.y + dy, floor: c.floor };
    if (isGround(map, n)) continue;
    const hasStair = map.connections.some((k) => {
      const [up, down] = k.a.floor > k.b.floor ? [k.a, k.b] : [k.b, k.a];
      return up.x === c.x && up.y === c.y && up.floor === c.floor && down.x === n.x && down.y === n.y;
    });
    if (hasStair) continue;
    const along = dx === 0;
    const rail = MeshBuilder.CreateBox('rail', { width: along ? CELL_SIZE : 0.12, depth: along ? 0.12 : CELL_SIZE, height: RAIL_HEIGHT }, scene);
    rail.position.set(w.x + dx * (CELL_SIZE / 2 - 0.06), w.y + RAIL_HEIGHT / 2, w.z + dy * (CELL_SIZE / 2 - 0.06));
    out.push(rail);
  }
  return out;
}

/** Pilares nos cantos convexos das plataformas (decorativos: sustentam a laje). */
function buildPillars(scene: Scene, map: GameMap, floor: number): Mesh[] {
  const counts = new Map<string, number>();
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (!isGround(map, { x, y, floor })) continue;
      for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const) {
        const k = `${cx},${cy}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  const out: Mesh[] = [];
  const height = floorToWorldY(floor) - floorToWorldY(floor - 1) - SLAB_THICKNESS;
  const size = 0.4;
  for (const [k, n] of counts) {
    if (n !== 1) continue;
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    // Recuo para dentro da única célula da plataforma que toca este canto: o pilar fica sob a laje.
    const owner = [[cx, cy], [cx - 1, cy], [cx, cy - 1], [cx - 1, cy - 1]].find(([x, y]) => isGround(map, { x: x!, y: y!, floor }))!;
    const insetX = owner[0] === cx ? 1 : -1;
    const insetY = owner[1] === cy ? 1 : -1;
    const p = MeshBuilder.CreateBox('pillar', { width: size, depth: size, height }, scene);
    p.position.set(cx * CELL_SIZE + insetX * (size / 2 + 0.05), floorToWorldY(floor - 1) + height / 2, cy * CELL_SIZE + insetY * (size / 2 + 0.05));
    out.push(p);
  }
  return out;
}

/** Degraus na célula de baixo, subindo em direção à célula de cima. */
function buildStairs(scene: Scene, a: Coord, b: Coord): Mesh[] {
  const [low, high] = a.floor <= b.floor ? [a, b] : [b, a];
  const dx = Math.sign(high.x - low.x);
  const dz = Math.sign(high.y - low.y);
  const rise = floorToWorldY(high.floor) - floorToWorldY(low.floor);
  const w = cellToWorld(low);
  const depth = CELL_SIZE / STAIR_STEPS;
  const out: Mesh[] = [];
  for (let i = 0; i < STAIR_STEPS; i++) {
    const h = (rise * (i + 1)) / STAIR_STEPS;
    const offset = -CELL_SIZE / 2 + depth * (i + 0.5);
    const step = MeshBuilder.CreateBox(
      'step',
      { width: dx !== 0 ? depth : CELL_SIZE * 0.85, depth: dz !== 0 ? depth : CELL_SIZE * 0.85, height: h },
      scene,
    );
    step.position.set(w.x + dx * offset, w.y + h / 2, w.z + dz * offset);
    out.push(step);
  }
  return out;
}
