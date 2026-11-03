/**
 * Destaques de células (seções 14.5 / 14.8): placas planas logo acima do piso.
 *
 * Cada camada (alcance, caminho, cursor, seleção) tem uma malha-base por andar com
 * *thin instances* — uma instância por célula, com cor própria — então mostrar as
 * 16 × 16 × 2 células custa uma chamada de desenho por andar. As malhas-base são
 * registradas no FloorView: acima do andar visualizado ficam fantasmas como o resto.
 * Nunca são selecionáveis (o picking as ignora; ver rendering/picking.ts).
 */
import { Color3, Matrix, MeshBuilder, StandardMaterial, type Mesh, type Scene } from '@babylonjs/core';
import type { Coord } from '@bardurinho/domain';
import type { FloorView } from './floorView.js';
import { CELL_SIZE, cellToWorld } from './grid.js';

/** Altura das placas acima da face do piso (superfícies ficam em +0,02). */
const BASE_OFFSET = 0.03;

export interface CellMark {
  cell: Coord;
  /** Cor `#rrggbb`. */
  color: string;
}

export interface HighlightLayerOptions {
  /** Opacidade da camada. */
  alpha: number;
  /** Lado da placa em metros (célula = 2 m). */
  size?: number;
  /** Ordem de desenho entre camadas transparentes (maior = por cima). */
  order: number;
}

export class CellHighlightLayer {
  private readonly bases: Mesh[] = [];

  constructor(
    scene: Scene,
    floorView: FloorView,
    name: string,
    private readonly opts: HighlightLayerOptions,
  ) {
    const mat = new StandardMaterial(`highlight:${name}`, scene);
    // Sem iluminação: a cor final é a emissiva (branca) × a cor da instância.
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.alpha = opts.alpha;
    mat.backFaceCulling = false;
    mat.zOffset = -1 - opts.order;
    const size = opts.size ?? CELL_SIZE * 0.92;
    for (let floor = 0; floor < floorView.floors; floor++) {
      const base = MeshBuilder.CreateGround(`highlight:${name}:floor${floor}`, { width: size, height: size }, scene);
      base.material = mat;
      base.isPickable = false;
      base.receiveShadows = false;
      base.alphaIndex = 100 + opts.order;
      base.metadata = { highlight: name };
      base.setEnabled(false);
      floorView.register(base, floor);
      this.bases.push(base);
    }
  }

  /** Substitui todas as células da camada. */
  set(marks: readonly CellMark[]): void {
    const byFloor = this.bases.map(() => [] as CellMark[]);
    for (const m of marks) byFloor[m.cell.floor]?.push(m);
    byFloor.forEach((list, floor) => {
      const base = this.bases[floor]!;
      if (list.length === 0) {
        base.setEnabled(false);
        return;
      }
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 4);
      list.forEach((m, i) => {
        const w = cellToWorld(m.cell);
        Matrix.Translation(w.x, w.y + BASE_OFFSET + this.opts.order * 0.004, w.z).copyToArray(matrices, i * 16);
        const c = Color3.FromHexString(m.color);
        colors.set([c.r, c.g, c.b, 1], i * 4);
      });
      base.thinInstanceSetBuffer('matrix', matrices, 16, false);
      base.thinInstanceSetBuffer('color', colors, 4, false);
      base.thinInstanceRefreshBoundingInfo(false);
      base.setEnabled(true);
    });
  }

  clear(): void {
    for (const b of this.bases) b.setEnabled(false);
  }
}
