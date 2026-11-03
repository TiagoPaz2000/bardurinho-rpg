/**
 * Partículas procedurais (Babylon `ParticleSystem`, CPU) com pool por predefinição.
 *
 * Os sistemas são criados sob demanda e devolvidos ao pool quando param — nada é
 * descartado no meio da partida. As capacidades ficam baixas (ver `PRESETS`): fogo de
 * superfície ≈ 40 partículas por célula; rajadas de explosão ≤ 90.
 *
 * Texturas geradas em código (DynamicTexture): brilho redondo suave, faísca e fumaça.
 */
import { Color3, Color4, DynamicTexture, ParticleSystem, Vector3, type Scene, type Texture } from '@babylonjs/core';

export type ParticlePreset = 'flame' | 'flameSmall' | 'sparks' | 'smoke' | 'rise' | 'frost' | 'trail' | 'dust' | 'shimmer';

interface PresetConfig {
  capacity: number;
  texture: 'soft' | 'spark' | 'smoke';
  configure(ps: ParticleSystem, color: Color3): void;
}

const c4 = (c: Color3, a: number) => new Color4(c.r, c.g, c.b, a);
const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, t);
const WHITE = new Color3(1, 1, 1);
const BLACK = new Color3(0, 0, 0);

/** Configura gradientes de cor/tamanho (os anteriores são limpos ao reaproveitar). */
function gradients(ps: ParticleSystem, colors: Array<[number, Color4]>, sizes: Array<[number, number]>): void {
  ps.getColorGradients()?.splice(0);
  ps.getSizeGradients()?.splice(0);
  for (const [t, c] of colors) ps.addColorGradient(t, c);
  for (const [t, s] of sizes) ps.addSizeGradient(t, s);
}

const PRESETS: Record<ParticlePreset, PresetConfig> = {
  /** Fogo de superfície/objeto: língua de fogo subindo de uma caixa. */
  flame: {
    capacity: 42,
    texture: 'soft',
    configure(ps, color) {
      ps.createBoxEmitter(new Vector3(-0.12, 1, -0.12), new Vector3(0.12, 1.4, 0.12), new Vector3(-0.6, 0, -0.6), new Vector3(0.6, 0.15, 0.6));
      ps.emitRate = 24;
      ps.minLifeTime = 0.45;
      ps.maxLifeTime = 0.8;
      ps.minSize = 0.45;
      ps.maxSize = 0.85;
      ps.minEmitPower = 0.9;
      ps.maxEmitPower = 1.5;
      ps.gravity = new Vector3(0, 0.8, 0);
      ps.minAngularSpeed = -1.5;
      ps.maxAngularSpeed = 1.5;
      // Mistura comum: a aditiva somava o piso claro e deixava o fogo cor de pêssego/branco.
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      const hot = mix(color, new Color3(1, 0.78, 0.25), 0.45);
      gradients(ps, [[0, c4(hot, 0)], [0.1, c4(hot, 0.8)], [0.4, c4(color, 0.7)], [0.75, c4(mix(color, new Color3(0.55, 0.06, 0.02), 0.6), 0.45)], [1, c4(new Color3(0.2, 0.05, 0.02), 0)]], [[0, 0.6], [0.3, 1], [1, 0.3]]);
    },
  },
  /** Fogo pequeno (personagem em chamas, faísca de mão). */
  flameSmall: {
    capacity: 22,
    texture: 'soft',
    configure(ps, color) {
      ps.createBoxEmitter(new Vector3(-0.1, 1, -0.1), new Vector3(0.1, 1.3, 0.1), new Vector3(-0.3, 0.1, -0.3), new Vector3(0.3, 1.3, 0.3));
      ps.emitRate = 16;
      ps.minLifeTime = 0.35;
      ps.maxLifeTime = 0.6;
      ps.minSize = 0.22;
      ps.maxSize = 0.42;
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 1.1;
      ps.gravity = new Vector3(0, 0.6, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      const hot = mix(color, new Color3(1, 0.78, 0.25), 0.45);
      gradients(ps, [[0, c4(hot, 0)], [0.15, c4(hot, 0.8)], [0.6, c4(color, 0.6)], [1, c4(new Color3(0.4, 0.05, 0.02), 0)]], [[0, 0.7], [0.3, 1], [1, 0.25]]);
    },
  },
  /** Faíscas de impacto/explosão (rajada). */
  sparks: {
    capacity: 90,
    texture: 'spark',
    configure(ps, color) {
      ps.createSphereEmitter(0.25, 1);
      ps.emitRate = 0;
      ps.minLifeTime = 0.25;
      ps.maxLifeTime = 0.6;
      ps.minSize = 0.12;
      ps.maxSize = 0.26;
      ps.minEmitPower = 3;
      ps.maxEmitPower = 7;
      ps.gravity = new Vector3(0, -9, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      gradients(ps, [[0, c4(mix(color, WHITE, 0.35), 1)], [0.5, c4(color, 0.9)], [1, c4(color, 0)]], [[0, 1], [1, 0.4]]);
    },
  },
  /** Fumaça escura (explosão), mistura comum. */
  smoke: {
    capacity: 30,
    texture: 'smoke',
    configure(ps, color) {
      ps.createSphereEmitter(0.8, 1);
      ps.emitRate = 0;
      ps.minLifeTime = 1.2;
      ps.maxLifeTime = 2.0;
      ps.minSize = 1.0;
      ps.maxSize = 1.8;
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 1.6;
      ps.gravity = new Vector3(0, 1.0, 0);
      ps.minAngularSpeed = -0.6;
      ps.maxAngularSpeed = 0.6;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      gradients(ps, [[0, c4(color, 0)], [0.1, c4(color, 0.65)], [0.6, c4(color, 0.4)], [1, c4(color, 0)]], [[0, 0.5], [1, 1.6]]);
    },
  },
  /** Partículas que sobem ao redor do personagem (cura, poções). */
  rise: {
    capacity: 40,
    texture: 'soft',
    configure(ps, color) {
      ps.createCylinderEmitter(0.55, 0.2, 0.3, 0);
      ps.emitRate = 0;
      ps.minLifeTime = 0.7;
      ps.maxLifeTime = 1.2;
      ps.minSize = 0.16;
      ps.maxSize = 0.32;
      ps.minEmitPower = 0.2;
      ps.maxEmitPower = 0.5;
      ps.gravity = new Vector3(0, 2.2, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      gradients(ps, [[0, c4(color, 0)], [0.2, c4(mix(color, WHITE, 0.1), 0.9)], [0.7, c4(color, 0.7)], [1, c4(color, 0)]], [[0, 0.5], [0.3, 1], [1, 0.3]]);
    },
  },
  /** Flocos de gelo caindo (lentidão). */
  frost: {
    capacity: 18,
    texture: 'spark',
    configure(ps, color) {
      ps.createCylinderEmitter(0.7, 0.6, 1, 0);
      ps.emitRate = 7;
      ps.minLifeTime = 0.9;
      ps.maxLifeTime = 1.4;
      ps.minSize = 0.07;
      ps.maxSize = 0.13;
      ps.minEmitPower = 0;
      ps.maxEmitPower = 0.1;
      ps.gravity = new Vector3(0, -0.9, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      gradients(ps, [[0, c4(color, 0)], [0.2, c4(color, 0.75)], [1, c4(color, 0)]], [[0, 1], [1, 0.6]]);
    },
  },
  /** Rastro de projétil (emissor móvel). */
  trail: {
    capacity: 40,
    texture: 'soft',
    configure(ps, color) {
      ps.createSphereEmitter(0.08, 1);
      ps.emitRate = 55;
      ps.minLifeTime = 0.15;
      ps.maxLifeTime = 0.3;
      ps.minSize = 0.14;
      ps.maxSize = 0.28;
      ps.minEmitPower = 0;
      ps.maxEmitPower = 0.2;
      ps.gravity = new Vector3(0, 0, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      gradients(ps, [[0, c4(color, 0.45)], [1, c4(color, 0)]], [[0, 1], [1, 0.2]]);
    },
  },
  /** Poeira no chão (investida, queda, destroços). */
  dust: {
    capacity: 30,
    texture: 'smoke',
    configure(ps, color) {
      ps.createCylinderEmitter(0.5, 0.1, 1, 0);
      ps.emitRate = 0;
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 0.9;
      ps.minSize = 0.4;
      ps.maxSize = 0.8;
      ps.minEmitPower = 1;
      ps.maxEmitPower = 2;
      ps.gravity = new Vector3(0, 0.3, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      gradients(ps, [[0, c4(color, 0)], [0.15, c4(color, 0.55)], [1, c4(color, 0)]], [[0, 0.6], [1, 1.5]]);
    },
  },
  /** Brilho tênue que pisca ao redor (ocultação, barreira). */
  shimmer: {
    capacity: 16,
    texture: 'spark',
    configure(ps, color) {
      ps.createSphereEmitter(0.7, 0.2);
      ps.emitRate = 6;
      ps.minLifeTime = 0.6;
      ps.maxLifeTime = 1.0;
      ps.minSize = 0.08;
      ps.maxSize = 0.18;
      ps.minEmitPower = 0;
      ps.maxEmitPower = 0.15;
      ps.gravity = new Vector3(0, 0.25, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      gradients(ps, [[0, c4(color, 0)], [0.5, c4(color, 0.8)], [1, c4(color, 0)]], [[0, 1], [1, 1]]);
    },
  },
};

function makeTexture(scene: Scene, kind: 'soft' | 'spark' | 'smoke'): Texture {
  const size = 64;
  const tex = new DynamicTexture(`fx:tex:${kind}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'spark') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else if (kind === 'smoke') {
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (kind === 'smoke') {
    // Manchas para a fumaça não parecer uma bola lisa.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 14 + (i % 3) * 5;
      ctx.beginPath();
      ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 5 + (i % 2) * 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
    }
  }
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export interface ParticleHandle {
  readonly system: ParticleSystem;
  /** Para de emitir; o sistema volta ao pool quando as partículas vivas terminam. */
  stop(): void;
}

export class ParticleFx {
  private readonly pools = new Map<ParticlePreset, ParticleSystem[]>();
  private readonly textures = new Map<string, Texture>();
  /** Sistemas em uso (diagnóstico / limite). */
  active = 0;

  constructor(private readonly scene: Scene) {}

  private texture(kind: 'soft' | 'spark' | 'smoke'): Texture {
    let t = this.textures.get(kind);
    if (!t) {
      t = makeTexture(this.scene, kind);
      this.textures.set(kind, t);
    }
    return t;
  }

  private acquire(preset: ParticlePreset, emitter: Vector3, color: Color3): ParticleSystem {
    const pool = this.pools.get(preset) ?? [];
    this.pools.set(preset, pool);
    const cfg = PRESETS[preset];
    let ps = pool.pop();
    if (!ps) {
      ps = new ParticleSystem(`fx:${preset}`, cfg.capacity, this.scene);
      ps.particleTexture = this.texture(cfg.texture);
      ps.preventAutoStart = true;
      ps.isBillboardBased = true;
    } else ps.reset();
    cfg.configure(ps, color);
    ps.emitter = emitter;
    ps.manualEmitCount = -1;
    ps.targetStopDuration = 0;
    ps.updateSpeed = 1 / 60;
    this.active++;
    return ps;
  }

  private release(preset: ParticlePreset, ps: ParticleSystem): void {
    this.active--;
    if (this.scene.isDisposed) return;
    this.pools.get(preset)!.push(ps);
  }

  /** Emissão contínua (fogo, gelo, rastro). `emitter` pode ser movido a cada quadro. */
  loop(preset: ParticlePreset, emitter: Vector3, color: Color3, rateScale = 1): ParticleHandle {
    const ps = this.acquire(preset, emitter, color);
    ps.emitRate *= rateScale;
    ps.start();
    let stopped = false;
    return {
      system: ps,
      stop: () => {
        if (stopped) return;
        stopped = true;
        ps.stop();
        // Deixa as partículas vivas terminarem antes de reaproveitar o sistema.
        window.setTimeout(() => this.release(preset, ps), ps.maxLifeTime * 1000 + 50);
      },
    };
  }

  /** Rajada única de `count` partículas; devolve ao pool sozinho. */
  burst(preset: ParticlePreset, at: Vector3, color: Color3, count: number, tune?: (ps: ParticleSystem) => void): void {
    if (this.scene.isDisposed) return;
    const ps = this.acquire(preset, at.clone(), color);
    tune?.(ps);
    ps.manualEmitCount = Math.min(count, PRESETS[preset].capacity);
    ps.start();
    window.setTimeout(() => {
      ps.stop();
      this.release(preset, ps);
    }, ps.maxLifeTime * 1000 + 120);
  }
}
