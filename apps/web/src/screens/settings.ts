/**
 * Preferências do cliente (etapa 6), guardadas no navegador (`localStorage`).
 *
 * O ritmo das animações (normal / rápido) continua com a chave própria de `pace`
 * (rendering/anim.ts, `bardurinho.pace`); aqui ficam as demais.
 */
import type { AutoCameraPreference } from '../rendering/camera/index.js';

export interface ClientSettings {
  /** Câmera automática (seções 14.10–14.13): alta / reduzida / desativada. */
  autoCamera: AutoCameraPreference;
  /** Sensibilidade da câmera (pan por teclado/arrasto e zoom), 0,5–2. */
  cameraSensitivity: number;
  /** Arrastar move a câmera no sentido do mouse (em vez de "agarrar" o chão). */
  invertDrag: boolean;
  /** Scroll para cima afasta (em vez de aproximar). */
  invertZoom: boolean;
  /** Tremor de câmera nas explosões. */
  cameraShake: boolean;
  /** Fase 4: volume dos efeitos sonoros, 0 (mudo) – 1. */
  sfxVolume: number;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  autoCamera: 'high',
  cameraSensitivity: 1,
  invertDrag: false,
  invertZoom: false,
  cameraShake: true,
  sfxVolume: 0.6,
};

const STORAGE_KEY = 'bardurinho.settings';
const PREFS: readonly AutoCameraPreference[] = ['high', 'reduced', 'off'];

/** Valida um objeto lido do armazenamento (campos inválidos voltam ao padrão). */
export function normalizeSettings(raw: unknown): ClientSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ClientSettings, unknown>>;
  const sens = Number(r.cameraSensitivity);
  const vol = Number(r.sfxVolume);
  return {
    autoCamera: PREFS.includes(r.autoCamera as AutoCameraPreference) ? (r.autoCamera as AutoCameraPreference) : DEFAULT_SETTINGS.autoCamera,
    cameraSensitivity: Number.isFinite(sens) ? Math.min(2, Math.max(0.5, Math.round(sens * 10) / 10)) : DEFAULT_SETTINGS.cameraSensitivity,
    invertDrag: typeof r.invertDrag === 'boolean' ? r.invertDrag : DEFAULT_SETTINGS.invertDrag,
    invertZoom: typeof r.invertZoom === 'boolean' ? r.invertZoom : DEFAULT_SETTINGS.invertZoom,
    cameraShake: typeof r.cameraShake === 'boolean' ? r.cameraShake : DEFAULT_SETTINGS.cameraShake,
    sfxVolume: r.sfxVolume !== undefined && r.sfxVolume !== null && Number.isFinite(vol) ? Math.min(1, Math.max(0, Math.round(vol * 20) / 20)) : DEFAULT_SETTINGS.sfxVolume,
  };
}

export function loadSettings(): ClientSettings {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: ClientSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* armazenamento indisponível: vale só nesta sessão */
  }
}
