/**
 * Personagens: modelo GLB da classe (`assets/models/characters/<classId>.glb`) sobre um
 * disco na cor da equipe. Os modelos são estáticos (sem esqueleto): as animações são
 * transformações procedurais (`UnitAnimator`) aplicadas em dois nós:
 *
 *   root (posição lógica / passo) → pose (deslocamentos, giro, respiração) → model (direção,
 *   inclinação, escala) → malhas do GLB
 *
 * Tintas (lentidão), lampejos (dano, cura) e opacidade (ocultação, derrota) também ficam
 * aqui, para que os efeitos não briguem pelas mesmas propriedades das malhas.
 */
import { Color3, MeshBuilder, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { GameMap, Unit } from '@bardurinho/domain';
import { standingPoint } from './terrain.js';
import type { ModelLibrary } from './loaders.js';
import { PALETTE, type Materials } from './materials.js';

/** `recommendedScale` de assets/models/characters/manifest.json (altura ≈ 1,67 m). */
export const CHARACTER_SCALE = 1.7;
const characterUrl = (classId: string) => `/models/characters/${classId}.glb`;

export interface UnitViewContext {
  scene: Scene;
  /** Mapa (altura dos degraus nas células de escada). */
  map: GameMap;
  mats: Materials;
  models: ModelLibrary;
  /** Centro da arena em células (para virar o personagem para dentro da arena). */
  centerY: number;
  onMesh: (mesh: AbstractMesh, castsShadow: boolean) => void;
  /** Andar fantasma (acima do visualizado): a opacidade base fica baixa. */
  isGhost: (floor: number) => boolean;
}

export class UnitView {
  readonly root: TransformNode;
  /** Nó das animações procedurais (sem rotação de direção: deslocamentos em coordenadas do mundo). */
  readonly pose: TransformNode;
  /** Nó do modelo: `rotation.y` = direção; `rotation.x` = inclinação para a frente. */
  readonly model: TransformNode;
  private readonly ring: AbstractMesh;
  private readonly disc: AbstractMesh;
  private bodyMeshes: AbstractMesh[] = [];
  readonly ready: Promise<void>;
  /** Andar lógico atual (para a opacidade de fantasma). */
  floor: number;
  alive: boolean;
  /** Tinta contínua (ex.: lentidão = azul gelo); `null` = sem tinta. */
  private tint: { color: Color3; alpha: number } | null = null;
  private flashColor = new Color3();
  private flashAlpha = 0;
  /** Opacidade própria (ocultação, derrota); multiplica a opacidade do andar. */
  private opacity = 1;

  constructor(
    private readonly ctx: UnitViewContext,
    unit: Unit,
  ) {
    const { scene, mats } = ctx;
    this.floor = unit.pos.floor;
    this.alive = unit.alive;
    this.root = new TransformNode(`unit:${unit.id}`, scene);
    this.root.metadata = { entityId: unit.id, entity: 'unit' };
    this.pose = new TransformNode(`unit:${unit.id}:pose`, scene);
    this.pose.parent = this.root;
    this.model = new TransformNode(`unit:${unit.id}:model`, scene);
    this.model.parent = this.pose;
    this.model.scaling.setAll(CHARACTER_SCALE);
    // Frente do modelo = +Z. Apresentação: olhar para o centro da arena (eixo Z).
    this.model.rotation.y = unit.pos.y < ctx.centerY ? 0 : Math.PI;

    const teamHex = PALETTE.team[unit.team] ?? PALETTE.teamFallback;
    this.ring = MeshBuilder.CreateTorus(`unit:${unit.id}:ring`, { diameter: 1.5, thickness: 0.12, tessellation: 32 }, scene);
    this.ring.material = mats.solid(teamHex, { emissive: 0.6 });
    this.ring.position.y = 0.06;
    this.ring.parent = this.root;
    this.disc = MeshBuilder.CreateDisc(`unit:${unit.id}:disc`, { radius: 0.72, tessellation: 32 }, scene);
    this.disc.material = mats.solid(teamHex, { emissive: 0.3, alpha: 0.35 });
    this.disc.rotation.x = Math.PI / 2;
    this.disc.position.y = 0.03;
    this.disc.parent = this.root;
    this.disc.isPickable = false;

    const classId = unit.classId;
    if (classId) {
      this.ready = ctx.models.load(characterUrl(classId)).then((container) => {
        const inst = container.instantiateModelsToScene((n) => `${unit.id}:${n}`, false);
        for (const r of inst.rootNodes) {
          r.parent = this.model;
          for (const m of r.getChildMeshes(false)) {
            m.metadata = { ...(m.metadata ?? {}), entityId: unit.id };
            ctx.onMesh(m, true);
            this.bodyMeshes.push(m);
          }
        }
        this.refreshOverlay();
      });
    } else {
      // Boneco de teste (sem classe): cápsula cinza.
      const c = MeshBuilder.CreateCapsule(`unit:${unit.id}:dummy`, { height: 1.7, radius: 0.35 }, scene);
      c.material = mats.solid('#b0b0b0');
      c.position.y = 0.85;
      c.parent = this.pose;
      ctx.onMesh(c, true);
      this.bodyMeshes.push(c);
      this.ready = Promise.resolve();
    }
    this.update(unit, false);
  }

  update(unit: Unit, active: boolean): void {
    const w = standingPoint(this.ctx.map, unit.pos);
    this.root.position.set(w.x, w.y, w.z);
    this.floor = unit.pos.floor;
    this.alive = unit.alive;
    this.root.setEnabled(unit.alive);
    this.ring.scaling.setAll(active ? 1.15 : 1);
  }

  /** Vira o modelo para a direção (dx, dz) no plano do chão (frente do modelo = +Z). */
  face(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.model.rotation.y = Math.atan2(dx, dz);
  }

  /** Direção atual (vetor unitário no plano do chão). */
  facing(): { x: number; z: number } {
    const a = this.model.rotation.y;
    return { x: Math.sin(a), z: Math.cos(a) };
  }

  /** Posição visual intermediária (animação); `update` volta à posição lógica. */
  setVisualPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  /** Ponto acima da cabeça (rótulos de dano). */
  headPosition(): { x: number; y: number; z: number } {
    const p = this.root.position;
    return { x: p.x, y: p.y + 2.1, z: p.z };
  }

  /** Malhas do corpo (sem anel/disco da equipe). */
  get meshes(): readonly AbstractMesh[] {
    return this.bodyMeshes;
  }

  // --- Tinta, lampejo e opacidade -----------------------------------------------------

  setTint(color: Color3 | null, alpha = 0.32): void {
    this.tint = color ? { color, alpha } : null;
    this.refreshOverlay();
  }

  /** Lampejo de cor que decai sozinho (`decay()` a cada quadro pelo animador). */
  flash(color: Color3, alpha = 0.7): void {
    this.flashColor.copyFrom(color);
    this.flashAlpha = alpha;
    this.refreshOverlay();
  }

  /** Decai o lampejo; chamado pelo animador a cada quadro. */
  decay(dt: number): void {
    if (this.flashAlpha <= 0) return;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.6);
    this.refreshOverlay();
  }

  private refreshOverlay(): void {
    const flash = this.flashAlpha > 0.01;
    const on = flash || !!this.tint;
    const color = flash ? this.flashColor : this.tint?.color;
    const alpha = flash ? Math.max(this.flashAlpha, this.tint?.alpha ?? 0) : (this.tint?.alpha ?? 0);
    for (const m of this.bodyMeshes) {
      m.renderOverlay = on;
      if (on && color) {
        m.overlayColor = color;
        m.overlayAlpha = alpha;
      }
    }
  }

  setOpacity(value: number): void {
    this.opacity = value;
    this.applyVisibility();
  }

  get currentOpacity(): number {
    return this.opacity;
  }

  /** Aplica opacidade própria × andar (o FloorView só atualiza ao trocar de andar). */
  applyVisibility(): void {
    const base = this.ctx.isGhost(this.floor) ? 0.12 : 1;
    const v = base * this.opacity;
    for (const m of this.bodyMeshes) m.visibility = v;
    const team = base * Math.min(1, this.opacity * 1.5);
    this.ring.visibility = team;
    this.disc.visibility = team;
  }

  dispose(): void {
    this.root.dispose();
  }
}
