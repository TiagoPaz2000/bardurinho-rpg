/**
 * Animações falsas dos personagens (seção 7.2): os modelos não têm esqueleto, então cada
 * animação é uma transformação procedural dos nós `pose` / `model` do `UnitView`.
 *
 * | id            | movimento                                                         |
 * |---------------|-------------------------------------------------------------------|
 * | idle          | respiração (escala vertical) e balanço leve, contínuos            |
 * | walk / run    | pulinho por passo (eventPlayback.playStep)                        |
 * | melee         | recua, investe ~0,75 m na direção do alvo e volta                 |
 * | shoot         | inclina para trás, recuo curto ao soltar; brilho nas mãos         |
 * | cast_forward  | inclina para trás juntando brilho nas mãos, empurra para a frente |
 * | cast_self     | sobe e gira uma volta, anel de brilho nos pés                     |
 * | hit           | recuo para longe da origem + lampejo vermelho                     |
 * | dodge         | esquiva: passo lateral e inclinação (ataque que errou)            |
 * | death         | tomba para trás, afunda e desaparece                              |
 * | interact      | inclina e dá meio passo em direção ao objeto                      |
 *
 * `play` devolve `release` (instante em que o golpe/projétil sai) e `done` (fim). As
 * durações seguem o ritmo da reprodução (`pace`); a respiração não.
 */
import { Color3, MeshBuilder, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { bell, easeInOut, easeOut, hash, tween } from './anim.js';
import type { Materials } from './materials.js';
import type { UnitView } from './units.js';

export type UnitAnimationId = 'idle' | 'walk' | 'run' | 'melee' | 'shoot' | 'cast_forward' | 'cast_self' | 'hit' | 'dodge' | 'death' | 'interact';

export interface AnimationRequest {
  /** Ponto do mundo para onde a ação se dirige (alvo, objeto) ou de onde veio o golpe (hit). */
  toward?: Vector3;
  /** Cor do brilho nas mãos / anel (família do efeito). */
  color?: Color3;
}

export interface AnimationHandle {
  release: Promise<void>;
  done: Promise<void>;
}

interface PoseState {
  offset: Vector3;
  rise: number;
  lean: number;
  tip: number;
  spin: number;
  phase: number;
  /** Uma animação de ação em curso (suspende a respiração). */
  busy: number;
}

const DURATIONS: Record<string, number> = {
  melee: 0.5,
  shoot: 0.5,
  cast_forward: 0.55,
  cast_self: 0.65,
  hit: 0.32,
  dodge: 0.42,
  death: 0.95,
  interact: 0.45,
};

/** Instante (0–1) em que a ação "solta" o efeito. */
const RELEASE_AT: Record<string, number> = { melee: 0.5, shoot: 0.55, cast_forward: 0.6, cast_self: 0.7, interact: 0.5 };

const DEFAULT_GLOW = new Color3(1, 0.85, 0.5);
const HIT_RED = new Color3(1, 0.12, 0.08);

export class UnitAnimator {
  private readonly poses = new WeakMap<UnitView, PoseState>();
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly mats: Materials,
    private readonly units: () => Iterable<UnitView>,
  ) {
    scene.onBeforeRenderObservable.add(() => this.frame());
  }

  private state(view: UnitView): PoseState {
    let s = this.poses.get(view);
    if (!s) {
      s = { offset: Vector3.Zero(), rise: 0, lean: 0, tip: 0, spin: 0, phase: (hash(view.root.name) % 1000) / 159, busy: 0 };
      this.poses.set(view, s);
    }
    return s;
  }

  private frame(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    for (const view of this.units()) {
      const s = this.state(view);
      // Respiração: só fora de ações; amplitude pequena para não parecer pulo.
      const breathe = s.busy > 0 || !view.alive ? 0 : Math.sin(this.time * 2.1 + s.phase);
      view.pose.position.set(s.offset.x, s.offset.y + s.rise + breathe * 0.012, s.offset.z);
      view.pose.scaling.set(1, 1 + breathe * 0.014, 1);
      view.pose.rotation.y = s.spin;
      view.model.rotation.x = s.lean;
      view.model.rotation.z = s.tip;
      view.decay(dt);
      view.applyVisibility();
    }
  }

  /** Volta a pose ao neutro (ex.: personagem revivido / sincronização). */
  reset(view: UnitView): void {
    const s = this.state(view);
    s.offset.setAll(0);
    s.rise = s.lean = s.tip = s.spin = 0;
    s.busy = 0;
  }

  play(view: UnitView, id: UnitAnimationId | string | undefined, req: AnimationRequest = {}): AnimationHandle {
    const anim = id && DURATIONS[id] ? id : null;
    if (!anim) return { release: Promise.resolve(), done: Promise.resolve() };
    const s = this.state(view);
    const p = view.root.position;
    // Direção da ação no plano do chão (para o alvo; no "hit", para longe da origem).
    let dir = new Vector3(view.facing().x, 0, view.facing().z);
    if (req.toward) {
      const d = new Vector3(req.toward.x - p.x, 0, req.toward.z - p.z);
      if (d.lengthSquared() > 1e-4) {
        dir = d.normalize();
        if (anim !== 'hit' && anim !== 'death' && anim !== 'dodge') view.face(dir.x, dir.z);
      }
    }
    if (anim === 'hit') dir.scaleInPlace(-1);
    const color = req.color ?? DEFAULT_GLOW;
    const releaseAt = RELEASE_AT[anim] ?? 0;
    let released = false;
    let resolveRelease!: () => void;
    const release = new Promise<void>((r) => (resolveRelease = r));
    const fireRelease = () => {
      if (released) return;
      released = true;
      resolveRelease();
    };
    if (!releaseAt) fireRelease();

    const glow = anim === 'shoot' || anim === 'cast_forward' ? this.handGlow(view, dir, color) : null;
    const ring = anim === 'cast_self' ? this.feetRing(view, color) : null;
    if (anim === 'hit') view.flash(HIT_RED, 0.75);

    s.busy++;
    const done = tween(this.scene, DURATIONS[anim]!, (t) => {
      if (!released && t >= releaseAt) fireRelease();
      switch (anim) {
        case 'melee': {
          // Recua (0–0,3), investe (0,3–0,55), volta (0,55–1).
          const k = t < 0.3 ? -0.18 * easeOut(t / 0.3) : t < 0.55 ? -0.18 + 0.98 * easeOut((t - 0.3) / 0.25) : 0.8 * (1 - easeInOut((t - 0.55) / 0.45));
          s.offset.copyFrom(dir.scale(k));
          s.lean = t < 0.3 ? -0.15 * (t / 0.3) : t < 0.55 ? -0.15 + 0.45 * ((t - 0.3) / 0.25) : 0.3 * (1 - (t - 0.55) / 0.45);
          s.rise = bell(Math.min(1, t / 0.6)) * 0.08;
          break;
        }
        case 'shoot': {
          s.lean = t < 0.55 ? -0.2 * easeOut(t / 0.55) : -0.2 * (1 - easeInOut((t - 0.55) / 0.45));
          const recoil = t < 0.55 ? 0 : -0.15 * bell((t - 0.55) / 0.45);
          s.offset.copyFrom(dir.scale(recoil));
          break;
        }
        case 'cast_forward': {
          s.lean = t < 0.6 ? -0.24 * easeOut(t / 0.6) : t < 0.75 ? -0.24 + 0.5 * easeOut((t - 0.6) / 0.15) : 0.26 * (1 - (t - 0.75) / 0.25);
          s.offset.copyFrom(dir.scale(t < 0.6 ? 0 : 0.22 * bell((t - 0.6) / 0.4)));
          s.rise = bell(t) * 0.06;
          break;
        }
        case 'cast_self':
          s.rise = bell(t) * 0.38;
          s.spin = easeInOut(t) * Math.PI * 2;
          break;
        case 'hit': {
          s.offset.copyFrom(dir.scale(0.32 * (t < 0.3 ? easeOut(t / 0.3) : 1 - easeInOut((t - 0.3) / 0.7))));
          s.lean = -0.28 * bell(t);
          break;
        }
        case 'dodge': {
          // Passo lateral (perpendicular à origem do ataque) e volta.
          const side = (hash(view.root.name) & 1) === 0 ? 1 : -1;
          const k = 0.45 * bell(t) * side;
          s.offset.set(-dir.z * k, 0, dir.x * k);
          s.tip = -0.22 * bell(t) * side;
          s.lean = -0.08 * bell(t);
          break;
        }
        case 'death': {
          // Tomba para trás (inclinação negativa = para trás) e afunda; some no fim.
          s.lean = -1.45 * easeOut(Math.min(1, t / 0.6));
          s.tip = 0.25 * easeOut(Math.min(1, t / 0.6));
          s.rise = t < 0.6 ? 0.12 * bell(t / 0.6) : -0.35 * ((t - 0.6) / 0.4);
          view.setOpacity(t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
          break;
        }
        case 'interact': {
          s.offset.copyFrom(dir.scale(0.3 * bell(t)));
          s.lean = 0.32 * bell(t);
          break;
        }
      }
      if (glow) {
        const g = anim === 'shoot' ? (t < 0.55 ? t / 0.55 : 1 - (t - 0.55) / 0.45) : t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
        glow.scaling.setAll(0.15 + 0.85 * Math.max(0, g));
        glow.visibility = Math.max(0, g) * view.ghostFactor;
      }
      if (ring) {
        ring.scaling.setAll(0.4 + t * 1.3);
        ring.visibility = (1 - t) * view.ghostFactor;
      }
    }).then(() => {
      fireRelease();
      s.busy--;
      if (anim !== 'death') {
        s.offset.setAll(0);
        s.lean = s.tip = s.spin = s.rise = 0;
      }
      glow?.dispose();
      ring?.dispose();
    });
    return { release, done };
  }

  /** Esfera brilhante nas mãos (frente do personagem, altura do peito). */
  private handGlow(view: UnitView, dir: Vector3, color: Color3): Mesh {
    const m = MeshBuilder.CreateSphere(`fx:hands:${view.root.name}`, { diameter: 0.42, segments: 8 }, this.scene);
    m.material = this.mats.unlit(color.toHexString(), { alpha: 0.8 });
    m.isPickable = false;
    m.parent = view.pose;
    m.position.set(dir.x * 0.55, 1.15, dir.z * 0.55);
    return m;
  }

  /** Anel que se abre nos pés (habilidade sobre si). */
  private feetRing(view: UnitView, color: Color3): Mesh {
    const m = MeshBuilder.CreateTorus(`fx:feet:${view.root.name}`, { diameter: 1.6, thickness: 0.09, tessellation: 32 }, this.scene);
    m.material = this.mats.unlit(color.toHexString(), { alpha: 0.85 });
    m.isPickable = false;
    m.parent = view.root;
    m.position.y = 0.12;
    return m;
  }
}
