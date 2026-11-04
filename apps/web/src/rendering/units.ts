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
import { Color3, Material, MeshBuilder, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { GameMap, Unit } from '@bardurinho/domain';
import { GHOST_ENTITY_VISIBILITY } from './floorView.js';
import { standingPoint } from './terrain.js';
import type { ModelLibrary } from './loaders.js';
import { PALETTE, type Materials } from './materials.js';
import { applyAppearanceToMeshes, resolveAppearance } from './appearance.js';

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
  /** Materiais do corpo e o modo de transparência original (o glTF opaco ignora `visibility`). */
  private bodyMaterials: Array<{ mat: Material; mode: number | null }> | null = null;
  private translucent = false;
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
  /** No andar fantasma (acima do visualizado; definido pelo FloorView). */
  private ghost = false;

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
    this.ring.metadata = { ownVisibility: true };
    this.disc = MeshBuilder.CreateDisc(`unit:${unit.id}:disc`, { radius: 0.72, tessellation: 32 }, scene);
    this.disc.material = mats.solid(teamHex, { emissive: 0.3, alpha: 0.35 });
    this.disc.rotation.x = Math.PI / 2;
    this.disc.position.y = 0.03;
    this.disc.parent = this.root;
    this.disc.isPickable = false;
    this.disc.metadata = { ownVisibility: true, neverPickable: true };

    const classId = unit.classId;
    if (classId) {
      this.ready = ctx.models.load(characterUrl(classId)).then((container) => {
        // Materiais clonados por personagem: a translucidez (fantasma, oculto, derrota) troca o
        // modo de transparência só deste personagem.
        const inst = container.instantiateModelsToScene((n) => `${unit.id}:${n}`, true);
        for (const r of inst.rootNodes) {
          r.parent = this.model;
          for (const m of r.getChildMeshes(false)) {
            m.metadata = { ...(m.metadata ?? {}), entityId: unit.id, ownVisibility: true };
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
      c.metadata = { ownVisibility: true };
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

  /** Chamado pelo FloorView ao registrar/trocar o andar visualizado. */
  setGhost(ghost: boolean): void {
    this.ghost = ghost;
    this.applyVisibility();
  }

  get isGhost(): boolean {
    return this.ghost;
  }

  /** Fator de opacidade do andar (1 ou `GHOST_ENTITY_VISIBILITY`): efeitos e rótulos do personagem usam o mesmo. */
  get ghostFactor(): number {
    return this.ghost ? GHOST_ENTITY_VISIBILITY : 1;
  }

  /** Aplica opacidade própria × andar (chamado a cada quadro pelo animador). */
  applyVisibility(): void {
    const base = this.ghostFactor;
    const v = base * this.opacity;
    for (const m of this.bodyMeshes) m.visibility = v;
    this.setTranslucent(v < 0.999);
    const team = base * Math.min(1, this.opacity * 1.5);
    this.ring.visibility = team;
    this.disc.visibility = team;
  }

  /**
   * Materiais glTF opacos têm `transparencyMode = OPAQUE`, e aí o Babylon ignora
   * `mesh.visibility`: ao ficar translúcido o corpo passa para ALPHABLEND com pré-passo de
   * profundidade (só a casca da frente aparece, sem ver o interior do modelo).
   */
  private setTranslucent(on: boolean): void {
    if (on === this.translucent) return;
    // GLB ainda carregando: tenta de novo no próximo quadro.
    if (this.bodyMeshes.length === 0) return;
    this.translucent = on;
    if (!this.bodyMaterials) {
      const seen = new Set<Material>();
      for (const m of this.bodyMeshes) if (m.material) seen.add(m.material);
      this.bodyMaterials = [...seen].map((mat) => ({ mat, mode: mat.transparencyMode }));
    }
    for (const { mat, mode } of this.bodyMaterials) {
      mat.transparencyMode = on ? Material.MATERIAL_ALPHABLEND : mode;
      mat.needDepthPrePass = on;
    }
  }

  /**
   * Fase 5: cosméticos do personagem (cor/conjunto visual nos materiais do GLB, aura no anel).
   * Pode ser chamado antes de o modelo carregar.
   */
  setAppearance(appearance: Record<string, string> | null | undefined): void {
    const a = resolveAppearance(appearance);
    if (a.ring) {
      this.ring.material = this.ctx.mats.solid(a.ring, { emissive: 0.9 });
      this.disc.material = this.ctx.mats.solid(a.ring, { emissive: 0.5, alpha: 0.4 });
    }
    void this.ready.then(() => applyAppearanceToMeshes(this.bodyMeshes, a));
  }

  dispose(): void {
    this.root.dispose();
  }
}
