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
  type Scene,
} from '@babylonjs/core';
import { getCell, type GameState } from '@bardurinho/domain';
import { FloorView, GHOST_ENTITY_VISIBILITY } from './floorView.js';
import { ParticleFx } from './fx/particles.js';
import { StateFx } from './fx/stateFx.js';
import { CELL_SIZE, cellToWorld } from './grid.js';
import { ModelLibrary } from './loaders.js';
import { Materials } from './materials.js';
import { ObjectView } from './objects.js';
import { buildTerrain, type TerrainOccluder } from './terrain.js';
import { UnitAnimator } from './unitAnimator.js';
import { UnitView } from './units.js';
import { CombatVfx } from './vfx.js';

export class ArenaView {
  readonly vfx: CombatVfx;
  readonly mats: Materials;
  readonly models: ModelLibrary;
  readonly shadows: ShadowGenerator;
  readonly floorView: FloorView;
  /** Partículas procedurais (pool). */
  readonly particles: ParticleFx;
  /** Efeitos persistentes espelhando o estado (superfícies, estados, barreira, fogo). */
  readonly stateFx: StateFx;
  /** Animações procedurais dos personagens. */
  readonly animator: UnitAnimator;
  /** Blocos do terreno tratados pela oclusão da câmera. */
  readonly occluders: TerrainOccluder[];
  private readonly units = new Map<string, UnitView>();
  private readonly objects = new Map<string, ObjectView>();
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
    this.particles = new ParticleFx(scene);
    this.animator = new UnitAnimator(scene, this.mats, () => this.units.values());
    this.vfx = new CombatVfx(this);

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
    this.stateFx = new StateFx({
      scene,
      mats: this.mats,
      models: this.models,
      floorView: this.floorView,
      particles: this.particles,
      unitView: (id) => this.units.get(id),
      objectView: (id) => this.objects.get(id),
    });

    const terrain = buildTerrain(scene, map, this.mats);
    for (const m of terrain.casters) this.shadows.addShadowCaster(m, false);
    for (const { node, floor } of terrain.byFloor) this.floorView.register(node, floor);
    this.occluders = terrain.occluders;

    this.sync(initial);
  }

  private onMesh = (mesh: AbstractMesh, castsShadow: boolean) => {
    mesh.receiveShadows = true;
    if (castsShadow) {
      mesh.metadata = { ...(mesh.metadata ?? {}), castsShadow: true };
      this.shadows.addShadowCaster(mesh, false);
    }
  };

  /** Visão de um personagem (animação de movimento, rótulos). */
  unitView(id: string): UnitView | undefined {
    return this.units.get(id);
  }

  /** Visão de um objeto (rótulos de dano). */
  objectView(id: string): ObjectView | undefined {
    return this.objects.get(id);
  }

  /** Visões dos objetos (oclusores dinâmicos da câmera). */
  objectViews(): IterableIterator<ObjectView> {
    return this.objects.values();
  }

  /** Visões dos personagens. */
  unitViews(): IterableIterator<UnitView> {
    return this.units.values();
  }

  /** Mapa do estado sincronizado (geometria; a topologia não muda durante a partida). */
  get map(): GameState['map'] {
    return this.state.map;
  }

  /** Promessa resolvida quando todos os GLBs da cena atual terminarem de carregar. */
  async whenLoaded(): Promise<void> {
    await Promise.all([...this.units.values()].map((u) => u.ready).concat([...this.objects.values()].map((o) => o.ready), [this.vfx.ready]));
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
        view = new UnitView({ scene, map: state.map, mats, models, centerY: state.map.height / 2, onMesh: this.onMesh }, unit);
        this.units.set(unit.id, view);
        const v = view;
        // Registrado já (o andar vale para anel, disco e efeitos) e de novo quando o GLB carrega.
        const reg = () => this.floorView.register(v.root, this.floorView.floorOf(v.root) ?? this.state.units[unit.id]?.pos.floor ?? 0, { ghostVisibility: GHOST_ENTITY_VISIBILITY, onApply: (g) => v.setGhost(g) });
        reg();
        void v.ready.then(reg);
      }
      view.update(unit, state.turn.activeUnitId === unit.id);
      this.floorView.move(view.root, unit.pos.floor);
    }
    for (const [id, view] of this.units) if (!state.units[id]) (view.dispose(), this.units.delete(id));

    this.stateFx.sync(state);
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
