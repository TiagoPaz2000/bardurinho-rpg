/**
 * CameraOcclusion (seção 14.7): estruturas entre a câmera e os alvos importantes ficam
 * translúcidas — apenas no cliente, sem alterar colisão, visão, cobertura ou alcance.
 *
 * - Oclusores: segmentos de muro, pilares, lajes (com o guarda-corpo), escadas
 *   (`TerrainBuild.occluders`) e objetos altos (portas, portão, cisternas…), cada um com a
 *   sua caixa no mundo. Objetos são relidos a cada teste (abrem, quebram, somem).
 * - Alvos (`targets`, ligado pela tela): personagens vivos, célula sob o cursor, células
 *   válidas da mira e entidades/células envolvidas na reprodução em curso.
 * - A cada ~66 ms (15 Hz): raio câmera → cada ponto de alvo contra a caixa de cada oclusor
 *   (`findOccluders`). O oclusor atingido persegue `FADED` e volta a 1 quando deixa de cobrir,
 *   com amortecimento por quadro (sem saltos).
 * - Composição com o FloorView: visibilidade = min(fator do andar, fade); oclusor esmaecido
 *   não é selecionável (o clique atravessa para o alvo atrás). Ao trocar de andar
 *   (`floorView.version`) tudo é reaplicado.
 *
 * Trabalha só sobre malhas que o cliente já renderiza; não revela nada que a névoa (fase
 * futura) esconda — os alvos vêm do que já está visível na cena.
 */
import type { AbstractMesh, Camera, TransformNode } from '@babylonjs/core';
import type { FloorView } from '../floorView.js';
import { damp } from './CameraTransitions.js';
import { findOccluders, type OccluderBox, type OcclusionTargetPoint, type P3 } from './occlusionMath.js';

/** Opacidade de uma estrutura que cobre um alvo. */
export const OCCLUSION_FADED = 0.2;
/** Intervalo entre testes de raio (s). */
const TEST_INTERVAL = 1 / 15;
/** Velocidade do fade (1/s). */
const FADE_RATE = 10;
/** Altura mínima (m) para um objeto ser tratado como oclusor (barris e caixotes não). */
const MIN_OBJECT_HEIGHT = 1.3;

interface Occluder extends OccluderBox {
  key: string;
  floor: number;
  meshes: AbstractMesh[];
  fade: number;
  goal: number;
  /** Visibilidade aplicada por último (−1 = nunca). */
  applied: number;
  appliedVersion: number;
}

export interface OcclusionObjectSource {
  id: string;
  root: TransformNode;
  floor: number;
}

export class CameraOcclusion {
  private readonly statics: Occluder[] = [];
  private readonly objects = new Map<string, Occluder>();
  private timer = 0;
  enabled = true;
  /** Pontos que devem ficar à vista (ligado pela tela da arena). */
  targets: () => OcclusionTargetPoint[] = () => [];
  /** Objetos da cena (oclusores dinâmicos). */
  objectSource: () => Iterable<OcclusionObjectSource> = () => [];

  constructor(
    private readonly camera: Camera,
    private readonly floorView: FloorView,
  ) {}

  /** Registra uma estrutura estática (bloco do terreno). */
  addStatic(key: string, meshes: AbstractMesh[], floor: number): void {
    const box = boundsOf(meshes);
    if (!box) return;
    this.statics.push({ key, floor, meshes, ...box, fade: 1, goal: 1, applied: -1, appliedVersion: -1 });
  }

  /** Oclusores esmaecidos agora (depuração/capturas). */
  get faded(): string[] {
    return [...this.statics, ...this.objects.values()].filter((o) => o.goal < 1).map((o) => o.key);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = TEST_INTERVAL;
      this.test();
    }
    const version = this.floorView.version;
    for (const o of this.statics) this.step(o, dt, version);
    for (const o of this.objects.values()) this.step(o, dt, version);
  }

  private refreshObjects(): void {
    const seen = new Set<string>();
    for (const src of this.objectSource()) {
      if (!src.root.isEnabled()) continue;
      const meshes = src.root.getChildMeshes(false).filter((m) => m.isEnabled() && !m.metadata?.debris);
      const box = boundsOf(meshes);
      if (!box || box.max.y - box.min.y < MIN_OBJECT_HEIGHT) continue;
      seen.add(src.id);
      const cur = this.objects.get(src.id);
      if (cur) Object.assign(cur, box, { meshes, floor: src.floor });
      else this.objects.set(src.id, { key: `object:${src.id}`, entityId: src.id, floor: src.floor, meshes, ...box, fade: 1, goal: 1, applied: -1, appliedVersion: -1 });
    }
    for (const [id, o] of this.objects)
      if (!seen.has(id)) {
        // Saiu da lista (destruído, desligado): devolve a opacidade do andar.
        o.goal = o.fade = 1;
        this.apply(o, this.floorView.version, true);
        this.objects.delete(id);
      }
  }

  private test(): void {
    this.refreshObjects();
    const all = [...this.statics, ...this.objects.values()];
    const targets = this.enabled ? this.targets() : [];
    const cam = this.camera.globalPosition;
    const camP: P3 = { x: cam.x, y: cam.y, z: cam.z };
    const hit = targets.length ? findOccluders(camP, targets, all) : new Set<number>();
    all.forEach((o, i) => (o.goal = hit.has(i) ? OCCLUSION_FADED : 1));
  }

  private step(o: Occluder, dt: number, version: number): void {
    if (o.fade !== o.goal) o.fade = damp(o.fade, o.goal, FADE_RATE, dt);
    this.apply(o, version, false);
  }

  private apply(o: Occluder, version: number, force: boolean): void {
    const ghost = this.floorView.isGhost(o.floor);
    const v = Math.min(this.floorView.structureFactor(o.floor), o.fade);
    if (!force && Math.abs(v - o.applied) < 1e-3 && o.appliedVersion === version) return;
    o.applied = v;
    o.appliedVersion = version;
    const pickable = !ghost && o.fade > 0.6;
    for (const m of o.meshes) {
      if (m.isDisposed() || m.metadata?.ownVisibility) continue;
      m.visibility = v;
      if (!m.metadata?.neverPickable && !m.metadata?.debris) m.isPickable = pickable;
    }
  }
}

function boundsOf(meshes: readonly AbstractMesh[]): OccluderBox | null {
  let min: P3 | null = null;
  let max: P3 | null = null;
  for (const m of meshes) {
    if (m.isDisposed()) continue;
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    const a = bb.minimumWorld;
    const b = bb.maximumWorld;
    if (!min || !max) {
      min = { x: a.x, y: a.y, z: a.z };
      max = { x: b.x, y: b.y, z: b.z };
      continue;
    }
    min = { x: Math.min(min.x, a.x), y: Math.min(min.y, a.y), z: Math.min(min.z, a.z) };
    max = { x: Math.max(max.x, b.x), y: Math.max(max.y, b.y), z: Math.max(max.z, b.z) };
  }
  return min && max ? { min, max } : null;
}
