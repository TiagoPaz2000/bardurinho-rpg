/**
 * Paleta provisória (placeholder neutro) e cache de materiais.
 * Cores por `defId` de objeto e por equipe ficam aqui para serem trocadas sem mexer na cena.
 */
import { Color3, Constants, StandardMaterial, type Scene } from '@babylonjs/core';

export const PALETTE = {
  ground: '#8f8a7c',
  groundDark: '#66645d',
  platform: '#a39c8a',
  platformDark: '#6d6a61',
  wall: '#7d776c',
  rail: '#6b5a45',
  stairs: '#9a8d74',
  outside: '#33352f',
  stone: '#9d978a',
  wood: '#8a5a32',
  woodDark: '#5e3b1f',
  metal: '#5d636b',
  barrel: '#a33a26',
  crate: '#b88c50',
  water: '#3b7fc4',
  gold: '#d9b44a',
  focus: '#a46cff',
  leverKnob: '#d23c2c',
  surface: { oil: '#2b2412', fire: '#ff7a1a', thorns: '#4f7d2a' } as Record<string, string>,
  team: { A: '#3d7bff', B: '#ff4a4a' } as Record<string, string>,
  teamFallback: '#d0d0d0',
  /** Destaques de células (seção 14.8: verde = válida, azul = caminho, vermelho = inválida). */
  highlight: {
    rangeNear: '#5ee08a',
    rangeFar: '#1f8f4e',
    path: '#3d9bff',
    hover: '#ffffff',
    invalid: '#ff4040',
    selected: '#ffd43b',
    /** Modo de habilidade: alvo válido, inválido no alcance e área afetada (amarelo). */
    targetValid: '#40d26a',
    targetInvalid: '#c43a3a',
    area: '#ffd43b',
  },
} as const;

export class Materials {
  private readonly cache = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  /** Material fosco de cor sólida (reaproveitado por chave). */
  solid(hex: string, opts: { emissive?: number; alpha?: number; specular?: number; key?: string } = {}): StandardMaterial {
    const key = opts.key ?? `${hex}|${opts.emissive ?? 0}|${opts.alpha ?? 1}|${opts.specular ?? 0.05}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new StandardMaterial(`mat:${key}`, this.scene);
      const c = Color3.FromHexString(hex);
      m.diffuseColor = c;
      m.specularColor = new Color3(1, 1, 1).scale(opts.specular ?? 0.05);
      if (opts.emissive) m.emissiveColor = c.scale(opts.emissive);
      if (opts.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
      this.cache.set(key, m);
    }
    return m;
  }

  /**
   * Material sem iluminação (efeitos): a cor final é exatamente `hex` — os GLBs de VFX
   * trazem PBR com emissão × 1,6 somada à luz, o que estourava as cores para amarelo/branco.
   * `additive` soma ao fundo (brilhos); o padrão é mistura alfa comum (cor saturada).
   */
  unlit(hex: string, opts: { alpha?: number; additive?: boolean; key?: string } = {}): StandardMaterial {
    const key = opts.key ?? `unlit|${hex}|${opts.alpha ?? 1}|${opts.additive ? 'add' : 'blend'}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new StandardMaterial(`mat:${key}`, this.scene);
      m.disableLighting = true;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = Color3.FromHexString(hex);
      m.backFaceCulling = false;
      m.alpha = opts.alpha ?? 1;
      if (opts.additive) m.alphaMode = Constants.ALPHA_ADD;
      this.cache.set(key, m);
    }
    return m;
  }

  /** Material branco que usa as cores de vértice (pisos com leve variação por placa). */
  vertexColored(key: string): StandardMaterial {
    let m = this.cache.get(`vc:${key}`);
    if (!m) {
      m = new StandardMaterial(`mat:vc:${key}`, this.scene);
      m.diffuseColor = Color3.White();
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      this.cache.set(`vc:${key}`, m);
    }
    return m;
  }
}
