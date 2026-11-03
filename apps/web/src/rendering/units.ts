/**
 * Personagens: modelo GLB da classe (`assets/models/characters/<classId>.glb`) sobre um
 * disco na cor da equipe. Os modelos são estáticos (sem esqueleto); animações vêm depois.
 */
import { MeshBuilder, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { Unit } from '@bardurinho/domain';
import { cellToWorld } from './grid.js';
import type { ModelLibrary } from './loaders.js';
import { PALETTE, type Materials } from './materials.js';

/** `recommendedScale` de assets/models/characters/manifest.json (altura ≈ 1,67 m). */
export const CHARACTER_SCALE = 1.7;
const characterUrl = (classId: string) => `/models/characters/${classId}.glb`;

export interface UnitViewContext {
  scene: Scene;
  mats: Materials;
  models: ModelLibrary;
  /** Centro da arena em células (para virar o personagem para dentro da arena). */
  centerY: number;
  onMesh: (mesh: AbstractMesh, castsShadow: boolean) => void;
}

export class UnitView {
  readonly root: TransformNode;
  private readonly model: TransformNode;
  private readonly ring: AbstractMesh;
  readonly ready: Promise<void>;

  constructor(
    private readonly ctx: UnitViewContext,
    unit: Unit,
  ) {
    const { scene, mats } = ctx;
    this.root = new TransformNode(`unit:${unit.id}`, scene);
    this.root.metadata = { entityId: unit.id, entity: 'unit' };
    this.model = new TransformNode(`unit:${unit.id}:model`, scene);
    this.model.parent = this.root;
    this.model.scaling.setAll(CHARACTER_SCALE);
    // Frente do modelo = +Z. Apresentação: olhar para o centro da arena (eixo Z).
    this.model.rotation.y = unit.pos.y < ctx.centerY ? 0 : Math.PI;

    const teamHex = PALETTE.team[unit.team] ?? PALETTE.teamFallback;
    this.ring = MeshBuilder.CreateTorus(`unit:${unit.id}:ring`, { diameter: 1.5, thickness: 0.12, tessellation: 32 }, scene);
    this.ring.material = mats.solid(teamHex, { emissive: 0.6 });
    this.ring.position.y = 0.06;
    this.ring.parent = this.root;
    const disc = MeshBuilder.CreateDisc(`unit:${unit.id}:disc`, { radius: 0.72, tessellation: 32 }, scene);
    disc.material = mats.solid(teamHex, { emissive: 0.3, alpha: 0.35 });
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.03;
    disc.parent = this.root;
    disc.isPickable = false;

    const classId = unit.classId;
    if (classId) {
      this.ready = ctx.models.load(characterUrl(classId)).then((container) => {
        const inst = container.instantiateModelsToScene((n) => `${unit.id}:${n}`, false);
        for (const r of inst.rootNodes) {
          r.parent = this.model;
          for (const m of r.getChildMeshes(false)) {
            m.metadata = { ...(m.metadata ?? {}), entityId: unit.id };
            ctx.onMesh(m, true);
          }
        }
      });
    } else {
      // Boneco de teste (sem classe): cápsula cinza.
      const c = MeshBuilder.CreateCapsule(`unit:${unit.id}:dummy`, { height: 1.7, radius: 0.35 }, scene);
      c.material = mats.solid('#b0b0b0');
      c.position.y = 0.85;
      c.parent = this.root;
      ctx.onMesh(c, true);
      this.ready = Promise.resolve();
    }
    this.update(unit, false);
  }

  update(unit: Unit, active: boolean): void {
    const w = cellToWorld(unit.pos);
    this.root.position.set(w.x, w.y, w.z);
    this.root.setEnabled(unit.alive);
    this.ring.scaling.setAll(active ? 1.15 : 1);
  }

  dispose(): void {
    this.root.dispose();
  }
}
