/**
 * CameraTransitions (seção 14.3): movimentos suaves entre enquadramentos.
 * Amortecimento exponencial independente da taxa de quadros: cada valor persegue o
 * alvo e chega a ~99% em `1 / rate · 4,6` segundos.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  const t = 1 - Math.exp(-rate * dt);
  const next = current + (target - current) * t;
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/** Velocidades de amortecimento (1/s). */
export const TRANSITION_RATES = {
  target: 9,
  rotation: 10,
  zoom: 12,
} as const;
