/**
 * Fase 5: aparência do personagem sobre o GLB da classe (cosméticos: cor, conjunto visual,
 * aura). Só apresentação — os dados vêm de `@bardurinho/content` (`cosmeticsById`).
 *
 * - cor: multiplica o albedo/difuso dos materiais pela tinta (`tintStrength` 0–1);
 * - conjunto visual: brilho emissivo nos materiais;
 * - aura: cor do anel/disco sob o personagem (no lugar da cor da equipe).
 */
import { Color3, type AbstractMesh, type Material } from '@babylonjs/core';
import { cosmeticsById, type CosmeticPresentation } from '@bardurinho/content';

export interface ResolvedAppearance {
  tint: Color3 | null;
  tintStrength: number;
  emissive: Color3 | null;
  emissiveStrength: number;
  ring: string | null;
}

/** Junta a apresentação dos cosméticos equipados (ids desconhecidos são ignorados). */
export function resolveAppearance(appearance: Record<string, string> | null | undefined): ResolvedAppearance {
  const out: ResolvedAppearance = { tint: null, tintStrength: 0, emissive: null, emissiveStrength: 0, ring: null };
  for (const id of Object.values(appearance ?? {})) {
    const p: CosmeticPresentation | undefined = cosmeticsById[id]?.presentation;
    if (!p) continue;
    if (p.tint) {
      out.tint = Color3.FromHexString(p.tint);
      out.tintStrength = p.tintStrength ?? 0.5;
    }
    if (p.emissive) {
      out.emissive = Color3.FromHexString(p.emissive);
      out.emissiveStrength = p.emissiveStrength ?? 0.3;
    }
    if (p.ring) out.ring = p.ring;
  }
  return out;
}

type Colored = Material & { albedoColor?: Color3; diffuseColor?: Color3; emissiveColor?: Color3 };

/** Aplica cor e brilho nos materiais (clonados por personagem) das malhas do corpo. */
export function applyAppearanceToMeshes(meshes: readonly AbstractMesh[], a: ResolvedAppearance): void {
  const seen = new Set<Material>();
  for (const m of meshes) {
    const mat = m.material as Colored | null;
    if (!mat || seen.has(mat)) continue;
    seen.add(mat);
    const meta = (mat.metadata ??= {}) as { baseColor?: Color3; baseEmissive?: Color3 };
    const color = mat.albedoColor ?? mat.diffuseColor;
    if (color) {
      meta.baseColor ??= color.clone();
      const base = meta.baseColor;
      const target = a.tint ? Color3.Lerp(base, base.multiply(a.tint).scale(1.6), a.tintStrength) : base;
      color.copyFrom(target);
    }
    if (mat.emissiveColor) {
      meta.baseEmissive ??= mat.emissiveColor.clone();
      mat.emissiveColor.copyFrom(a.emissive ? meta.baseEmissive.add(a.emissive.scale(a.emissiveStrength)) : meta.baseEmissive);
    }
  }
}
