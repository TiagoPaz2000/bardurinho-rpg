/**
 * Geometria da oclusão da câmera (seção 14.7), sem dependência do Babylon (testável em
 * Node): segmento câmera → alvo contra caixas alinhadas aos eixos (teste de "slabs").
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface Box {
  min: P3;
  max: P3;
}

/** Ponto dentro da caixa expandida por `pad` metros. */
export function boxContains(b: Box, p: P3, pad = 0): boolean {
  return (
    p.x >= b.min.x - pad && p.x <= b.max.x + pad &&
    p.y >= b.min.y - pad && p.y <= b.max.y + pad &&
    p.z >= b.min.z - pad && p.z <= b.max.z + pad
  );
}

/**
 * O segmento `from` → `to` atravessa a caixa? `endTrim` (m) encurta o fim do segmento, para
 * uma estrutura encostada no alvo (o piso sob os pés, o batente da porta) não contar.
 */
export function segmentHitsBox(from: P3, to: P3, b: Box, endTrim = 0): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const tMax = Math.max(0, 1 - endTrim / len);
  let t0 = 0;
  let t1 = tMax;
  const axes: Array<[number, number, number, number]> = [
    [from.x, dx, b.min.x, b.max.x],
    [from.y, dy, b.min.y, b.max.y],
    [from.z, dz, b.min.z, b.max.z],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d;
    let c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

export interface OcclusionTargetPoint extends P3 {
  /** Entidade do alvo: o próprio objeto nunca é oclusor de si. */
  entityId?: string;
}

export interface OccluderBox extends Box {
  entityId?: string;
}

/** Margem: alvo dentro (ou encostado) de uma estrutura não a torna oclusora. */
const CONTAIN_PAD = 0.15;
/** Encurtamento do fim do raio (m). */
const END_TRIM = 0.35;

/**
 * Índices dos oclusores entre a câmera e algum alvo. Custo: oclusores × alvos testes de
 * slab (≈ 40 × 70 no pior caso do Pátio, a 15 Hz).
 */
export function findOccluders(camera: P3, targets: readonly OcclusionTargetPoint[], occluders: readonly OccluderBox[]): Set<number> {
  const hit = new Set<number>();
  occluders.forEach((o, i) => {
    for (const t of targets) {
      if (t.entityId && t.entityId === o.entityId) continue;
      if (boxContains(o, t, CONTAIN_PAD)) continue;
      if (segmentHitsBox(camera, t, o, END_TRIM)) {
        hit.add(i);
        return;
      }
    }
  });
  return hit;
}
