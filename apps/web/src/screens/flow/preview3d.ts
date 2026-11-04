/**
 * Fase 5: prévia 3D do personagem (GLB da classe girando, com a aparência equipada) nas telas
 * de criação e de equipamento. Um Engine próprio num canvas pequeno; `dispose()` ao sair.
 */
import { ArcRotateCamera, Color4, Engine, HemisphericLight, DirectionalLight, MeshBuilder, Scene, TransformNode, Vector3, type AbstractMesh } from '@babylonjs/core';
import { ModelLibrary } from '../../rendering/loaders.js';
import { Materials, PALETTE } from '../../rendering/materials.js';
import { applyAppearanceToMeshes, resolveAppearance } from '../../rendering/appearance.js';
import { CHARACTER_SCALE } from '../../rendering/units.js';

const TEAM_A = PALETTE.team.A ?? '#3d7bff';

export class CharacterPreview {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly models: ModelLibrary;
  private readonly mats: Materials;
  private readonly holder: TransformNode;
  private readonly ring: AbstractMesh;
  private meshes: AbstractMesh[] = [];
  private roots: Array<{ dispose(): void }> = [];
  private classId = '';
  private appearance: Record<string, string> = {};
  private token = 0;
  /** Prévia pronta (modelo carregado) — usado pelo e2e. */
  loaded: Promise<void> = Promise.resolve();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false });
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.1, 0.105, 0.115, 1);
    const cam = new ArcRotateCamera('preview', Math.PI / 2, 1.25, 4.4, new Vector3(0, 0.95, 0), this.scene);
    cam.minZ = 0.1;
    new HemisphericLight('h', new Vector3(0.2, 1, 0.3), this.scene).intensity = 0.8;
    const sun = new DirectionalLight('s', new Vector3(-0.4, -1, -0.6), this.scene);
    sun.intensity = 0.8;
    this.models = new ModelLibrary(this.scene);
    this.mats = new Materials(this.scene);
    this.holder = new TransformNode('holder', this.scene);
    this.holder.scaling.setAll(CHARACTER_SCALE);
    this.ring = MeshBuilder.CreateTorus('ring', { diameter: 1.5, thickness: 0.12, tessellation: 32 }, this.scene);
    this.ring.position.y = 0.05;
    this.ring.material = this.mats.solid(TEAM_A, { emissive: 0.6 });
    this.scene.onBeforeRenderObservable.add(() => {
      this.holder.rotation.y += Math.min(0.05, this.engine.getDeltaTime() / 1000) * 0.6;
    });
    this.engine.runRenderLoop(() => this.scene.render());
  }

  show(classId: string, appearance: Record<string, string>): void {
    this.appearance = appearance;
    const a = resolveAppearance(appearance);
    this.ring.material = this.mats.solid(a.ring ?? TEAM_A, { emissive: a.ring ? 0.9 : 0.6 });
    if (classId === this.classId) {
      applyAppearanceToMeshes(this.meshes, a);
      return;
    }
    this.classId = classId;
    const token = ++this.token;
    for (const r of this.roots) r.dispose();
    this.roots = [];
    this.meshes = [];
    this.loaded = this.models.load(`/models/characters/${classId}.glb`).then((container) => {
      if (token !== this.token) return;
      const inst = container.instantiateModelsToScene((n) => `preview:${n}`, true);
      for (const r of inst.rootNodes) {
        r.parent = this.holder;
        this.roots.push(r);
        this.meshes.push(...r.getChildMeshes(false));
      }
      applyAppearanceToMeshes(this.meshes, resolveAppearance(this.appearance));
    });
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
