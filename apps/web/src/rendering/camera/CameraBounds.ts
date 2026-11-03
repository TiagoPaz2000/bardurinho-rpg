/**
 * CameraBounds (seção 14.3): impede que a câmera saia excessivamente da arena.
 * Limita o ponto de foco ao retângulo da arena (com pequena margem) e o zoom a uma faixa.
 */
export interface CameraBoundsConfig {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Margem extra além da borda da arena, em metros. */
  margin: number;
  minRadius: number;
  maxRadius: number;
}

export class CameraBounds {
  constructor(readonly config: CameraBoundsConfig) {}

  clampX(x: number): number {
    const { minX, maxX, margin } = this.config;
    return Math.min(maxX + margin, Math.max(minX - margin, x));
  }

  clampZ(z: number): number {
    const { minZ, maxZ, margin } = this.config;
    return Math.min(maxZ + margin, Math.max(minZ - margin, z));
  }

  clampRadius(r: number): number {
    return Math.min(this.config.maxRadius, Math.max(this.config.minRadius, r));
  }
}
