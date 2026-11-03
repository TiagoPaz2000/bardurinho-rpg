/**
 * Visão 3D da arena: constrói e sincroniza a cena a partir de um `GameState`.
 * Somente leitura — o renderizador nunca aplica regras nem altera o estado (seção 9:
 * "Apresentação não decide resultados oficiais").
 */
import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  ShadowGenerator,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type LinesMesh,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { allCoords, getCell, type GameState, type SurfaceKind } from '@bardurinho/domain';
import { FloorView } from './floorView.js';
import { CELL_SIZE, cellToWorld } from './grid.js';
import { ModelLibrary } from './loaders.js';
import { Materials, PALETTE } from './materials.js';
import { ObjectView } from './objects.js';
import { buildTerrain } from './terrain.js';
import { UnitView } from './units.js';

export class ArenaView {
  readonly mats: Materials;
  readonly models: ModelLibrary;
  readonly shadows: ShadowGenerator;
  readonly floorView: FloorView;
  private readonly units = new Map<string, UnitView>();
  private readonly objects = new Map<string, ObjectView>();
  private readonly surfaces = new Map<string, { kind: SurfaceKind; mesh: Mesh }>();
  private gridOverlay: LinesMesh[] = [];
  private gridVisible = false;
  private state: GameState;

  constructor(
    readonly scene: Scene,
    initial: GameState,
  ) {
    this.state = initial;
    this.mats = new Materials(scene);
    this.models = new ModelLibrary(scene);

    const map = initial.map;
    const center = new Vector3((map.width * CELL_SIZE) / 2, 0, (map.height * CELL_SIZE) / 2);

    // Iluminação: hemisférica (preenchimento) + direcional com sombras suaves.
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.62;
    hemi.groundColor = new Color3(0.32, 0.3, 0.28);
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.3).normalize(), scene);
    sun.position = center.add(new Vector3(18, 40, 12));
    sun.intensity = 0.75;
    this.shadows = new ShadowGenerator(2048, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.002;
    this.shadows.normalBias = 0.02;

    this.floorView = new FloorView(map.floors, this.shadows);

    const terrain = buildTerrain(scene, map, this.mats);
    for (const m of terrain.casters) this.shadows.addShadowCaster(m, false);
    for (const { node, floor } of terrain.byFloor) this.floorView.register(node, floor);

    this.sync(initial);
  }

  private onMesh = (mesh: AbstractMesh, castsShadow: boolean) => {
    mesh.receiveShadows = true;
    if (castsShadow) {
      mesh.metadata = { ...(mesh.metadata ?? {}), castsShadow: true };
      this.shadows.addShadowCaster(mesh, false);
    }
  };

  /** Promessa resolvida quando todos os GLBs da cena atual terminarem de carregar. */
  async whenLoaded(): Promise<void> {
    await Promise.all([...this.units.values()].map((u) => u.ready).concat([...this.objects.values()].map((o) => o.ready)));
  }

  /** Atualiza a cena para refletir `state` (cria, move e remove entidades e superfícies). */
  sync(state: GameState): void {
    this.state = state;
    const { scene, mats, models } = this;

    // Objetos
    for (const obj of Object.values(state.objects)) {
      let view = this.objects.get(obj.id);
      if (!view) {
        view = new ObjectView({ scene, map: state.map, mats, models, onMesh: this.onMesh }, obj.id, obj.defId, obj);
        this.objects.set(obj.id, view);
        const v = view;
        void v.ready.then(() => this.floorView.register(v.root, this.state.objects[obj.id]?.pos.floor ?? 0));
      } else view.update(obj);
      this.floorView.move(view.root, obj.pos.floor);
    }
    for (const [id, view] of this.objects) if (!state.objects[id]) (view.dispose(), this.objects.delete(id));

    // Personagens
    for (const unit of Object.values(state.units)) {
      let view = this.units.get(unit.id);
      if (!view) {
        view = new UnitView({ scene, mats, models, centerY: state.map.height / 2, onMesh: this.onMesh }, unit);
        this.units.set(unit.id, view);
        const v = view;
        void v.ready.then(() => this.floorView.register(v.root, this.state.units[unit.id]?.pos.floor ?? 0));
      }
      view.update(unit, state.turn.activeUnitId === unit.id);
      this.floorView.move(view.root, unit.pos.floor);
    }
    for (const [id, view] of this.units) if (!state.units[id]) (view.dispose(), this.units.delete(id));

    this.syncSurfaces(state);
  }

  /** Superfícies (óleo, fogo, espinhos) como placas planas logo acima do piso. */
  private syncSurfaces(state: GameState): void {
    const seen = new Set<string>();
    for (const c of allCoords(state.map)) {
      const s = getCell(state.map, c)?.surface;
      if (!s) continue;
      const key = `${c.x},${c.y},${c.floor}`;
      seen.add(key);
      const existing = this.surfaces.get(key);
      if (existing?.kind === s.kind) continue;
      existing?.mesh.dispose();
      const w = cellToWorld(c);
      const mesh = MeshBuilder.CreateGround(`surface:${key}`, { width: CELL_SIZE * 0.96, height: CELL_SIZE * 0.96 }, this.scene);
      const hex = PALETTE.surface[s.kind] ?? '#ff00ff';
      mesh.material = this.mats.solid(hex, { alpha: s.kind === 'oil' ? 0.85 : 0.7, emissive: s.kind === 'fire' ? 0.9 : 0, specular: s.kind === 'oil' ? 0.9 : 0.05 });
      mesh.position.set(w.x, w.y + 0.02, w.z);
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      this.floorView.register(mesh, c.floor);
      this.surfaces.set(key, { kind: s.kind, mesh });
    }
    for (const [key, { mesh }] of this.surfaces)
      if (!seen.has(key)) {
        this.floorView.unregister(mesh);
        mesh.dispose();
        this.surfaces.delete(key);
      }
  }

  /** Overlay de debug: contorno fino das células de chão em cada andar (tecla G). */
  toggleGrid(): boolean {
    this.gridVisible = !this.gridVisible;
    if (this.gridVisible && this.gridOverlay.length === 0) this.buildGrid();
    for (const l of this.gridOverlay) l.setEnabled(this.gridVisible);
    return this.gridVisible;
  }

  get isGridVisible(): boolean {
    return this.gridVisible;
  }

  private buildGrid(): void {
    const map = this.state.map;
    for (let floor = 0; floor < map.floors; floor++) {
      const lines: Vector3[][] = [];
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          if (getCell(map, { x, y, floor })?.terrain !== 'ground') continue;
          const w = cellToWorld({ x, y, floor });
          const h = CELL_SIZE / 2 - 0.04;
          const yy = w.y + 0.03;
          lines.push([
            new Vector3(w.x - h, yy, w.z - h),
            new Vector3(w.x + h, yy, w.z - h),
            new Vector3(w.x + h, yy, w.z + h),
            new Vector3(w.x - h, yy, w.z + h),
            new Vector3(w.x - h, yy, w.z - h),
          ]);
        }
      const ls = MeshBuilder.CreateLineSystem(`grid:floor${floor}`, { lines }, this.scene);
      ls.color = floor === 0 ? new Color3(1, 1, 1) : new Color3(1, 0.9, 0.4);
      ls.alpha = 0.35;
      ls.isPickable = false;
      const parent = new TransformNode(`grid:floor${floor}:root`, this.scene);
      ls.parent = parent;
      this.floorView.register(parent, floor);
      this.gridOverlay.push(ls);
    }
  }
}
