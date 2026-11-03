/**
 * Relógio das animações da apresentação.
 *
 * - `pace`: ritmo da reprodução dos eventos. "Rápido" (tecla T / botão do HUD) divide as
 *   durações das animações de ação por 2; efeitos contínuos (fogo, idle) não mudam.
 * - `tween`: avança `fn(t)` de 0 a 1 pelo relógio de quadros da cena; resolve também se a
 *   cena for descartada, para a reprodução nunca ficar presa.
 */
import type { Scene } from '@babylonjs/core';

const STORAGE_KEY = 'bardurinho.pace';

export const pace = {
  /** Multiplicador de velocidade (1 = normal, 2 = rápido). */
  speed: readStored(),
  get fast(): boolean {
    return this.speed > 1;
  },
  setFast(fast: boolean): void {
    this.speed = fast ? 2 : 1;
    try {
      window.localStorage.setItem(STORAGE_KEY, fast ? 'fast' : 'normal');
    } catch {
      /* armazenamento indisponível: só nesta sessão */
    }
  },
};

function readStored(): number {
  try {
    if (typeof window === 'undefined') return 1;
    return window.localStorage.getItem(STORAGE_KEY) === 'fast' ? 2 : 1;
  } catch {
    return 1;
  }
}

/** Duração ajustada ao ritmo atual. */
export const paced = (seconds: number) => seconds / pace.speed;

export interface TweenOptions {
  /** Ignora o ritmo (efeitos que não fazem parte da sequência da ação). Padrão: false. */
  unpaced?: boolean;
}

export function tween(scene: Scene, seconds: number, fn: (t: number) => void, opts: TweenOptions = {}): Promise<void> {
  if (scene.isDisposed) return Promise.resolve();
  const duration = Math.max(1e-3, opts.unpaced ? seconds : paced(seconds));
  return new Promise((resolve) => {
    let elapsed = 0;
    const finish = () => {
      scene.onBeforeRenderObservable.remove(frame);
      scene.onDisposeObservable.remove(dispose);
      resolve();
    };
    const frame = scene.onBeforeRenderObservable.add(() => {
      elapsed += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      const t = Math.min(1, elapsed / duration);
      fn(t);
      if (t >= 1) finish();
    });
    const dispose = scene.onDisposeObservable.addOnce(finish);
    fn(0);
  });
}

/** Espera `seconds` (no ritmo atual) pelo relógio da cena. */
export const wait = (scene: Scene, seconds: number, opts?: TweenOptions) => tween(scene, seconds, () => {}, opts);

export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t: number) => t * t * (3 - 2 * t);
/** 0 → 1 → 0 (pico no meio). */
export const bell = (t: number) => Math.sin(Math.PI * t);

/** Hash estável de uma string (variação determinística por entidade/célula). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Gerador pseudoaleatório simples a partir de uma semente (apresentação apenas). */
export function rand(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}
