/**
 * Prévia rápida de um GLB em PNG (rasterizador por software, sem GPU), para conferir a forma
 * depois da otimização. Desenha três vistas ortográficas: lateral, de cima e 3/4.
 *
 *   npx tsx tools/models/preview.ts <entrada.glb> <saida.png> [tamanho=480]
 *
 * Só a geometria é desenhada (sombreamento por normal da face; texturas são ignoradas).
 */
import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { createCanvas } from '@napi-rs/canvas';

type Vec3 = [number, number, number];

/** Lê todos os triângulos do GLB em coordenadas de mundo. */
export async function loadTriangles(path: string): Promise<Float32Array> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  const chunks: Float32Array[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue;
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const idx = prim.getIndices();
        const count = idx ? idx.getCount() : pos.getCount();
        const out = new Float32Array(count * 3);
        const p: number[] = [0, 0, 0];
        for (let i = 0; i < count; i++) {
          pos.getElement(idx ? idx.getScalar(i) : i, p);
          const [x, y, z] = p as Vec3;
          out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        chunks.push(out);
      }
    });
  }
  const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return all;
}

/** Rasteriza os triângulos numa vista ortográfica girada (yaw em torno de Y, depois pitch em torno de X). */
function renderView(tris: Float32Array, size: number, yaw: number, pitch: number, label: string, rgba: Uint8ClampedArray, offsetX: number, width: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const n = tris.length / 3;
  const v = new Float32Array(tris.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = tris[i * 3]!, y = tris[i * 3 + 1]!, z = tris[i * 3 + 2]!;
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    v[i * 3] = x1; v[i * 3 + 1] = y2; v[i * 3 + 2] = z2;
    minX = Math.min(minX, x1); maxX = Math.max(maxX, x1); minY = Math.min(minY, y2); maxY = Math.max(maxY, y2);
  }
  const margin = 16;
  const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
  const ox = margin + (size - 2 * margin - (maxX - minX) * scale) / 2;
  const oy = margin + (size - 2 * margin - (maxY - minY) * scale) / 2;
  const zbuf = new Float32Array(size * size).fill(-Infinity);
  const light: Vec3 = [0.4, 0.8, 0.45];
  const ll = Math.hypot(...light);
  for (let t = 0; t < n / 3; t++) {
    const a = t * 9;
    const ax = (v[a]! - minX) * scale + ox, ay = size - ((v[a + 1]! - minY) * scale + oy), az = v[a + 2]!;
    const bx = (v[a + 3]! - minX) * scale + ox, by = size - ((v[a + 4]! - minY) * scale + oy), bz = v[a + 5]!;
    const cx = (v[a + 6]! - minX) * scale + ox, cyy = size - ((v[a + 7]! - minY) * scale + oy), cz = v[a + 8]!;
    // Normal da face (no espaço da vista) para sombreamento Lambert de dupla face.
    const ux = v[a + 3]! - v[a]!, uy = v[a + 4]! - v[a + 1]!, uz = v[a + 5]! - v[a + 2]!;
    const wx = v[a + 6]! - v[a]!, wy = v[a + 7]! - v[a + 1]!, wz = v[a + 8]! - v[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const shade = 0.25 + 0.75 * Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / (nl * ll));
    const area = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cyy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cyy)));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5, sy2 = py + 0.5;
        const w0 = ((bx - sx) * (cyy - sy2) - (by - sy2) * (cx - sx)) / area;
        const w1 = ((cx - sx) * (ay - sy2) - (cyy - sy2) * (ax - sx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const zi = py * size + px;
        if (z <= zbuf[zi]!) continue;
        zbuf[zi] = z;
        const o = (py * width + offsetX + px) * 4;
        rgba[o] = 200 * shade; rgba[o + 1] = 185 * shade; rgba[o + 2] = 160 * shade; rgba[o + 3] = 255;
      }
    }
  }
  return label;
}

export async function renderPreview(input: string, output: string, size = 480): Promise<void> {
  const tris = await loadTriangles(input);
  const views: Array<[string, number, number]> = [
    ['lateral', 0, 0],
    ['cima', 0, Math.PI / 2],
    ['3/4', Math.PI / 6, Math.PI / 6],
  ];
  const width = size * views.length;
  const rgba = new Uint8ClampedArray(width * size * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 40; rgba[i + 1] = 44; rgba[i + 2] = 52; rgba[i + 3] = 255; }
  views.forEach(([label, yaw, pitch], i) => renderView(tris, size, yaw, pitch, label, rgba, i * size, width));
  const canvas = createCanvas(width, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, size);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#ddd';
  ctx.font = '14px sans-serif';
  views.forEach(([label], i) => ctx.fillText(label, i * size + 8, 18));
  ctx.fillText(`${(tris.length / 9).toLocaleString('pt-BR')} triângulos`, 8, size - 8);
  writeFileSync(output, canvas.toBuffer('image/png'));
}

if (process.argv[1] && /preview\.ts$/.test(process.argv[1])) {
  const [input, output, size] = process.argv.slice(2);
  if (!input || !output) {
    console.error('uso: tsx tools/models/preview.ts <entrada.glb> <saida.png> [tamanho]');
    process.exit(1);
  }
  await renderPreview(input, output, size ? Number(size) : undefined);
  console.log(`Prévia: ${output}`);
}
