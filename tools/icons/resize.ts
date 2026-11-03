/**
 * Gera as versões web (256×256, seção 7.3 do plano) a partir das imagens-mestre.
 *
 * Para cada `assets/icons/<categoria>/master/<nome>.png` escreve
 * `assets/icons/<categoria>/<nome>.png`. As mestres nunca são alteradas.
 *
 * Fase 4: as mestres vêm com fundo branco opaco; a versão web fica com o fundo transparente
 * (preenchimento a partir das bordas sobre pixels quase brancos e sem cor, com borda suave),
 * para os ícones aparecerem sobre o HUD escuro como os SVGs (docs/icones.md).
 *
 * Uso: npm run icons
 */
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Image, type Canvas } from '@napi-rs/canvas';

const SIZE = 256;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const iconsDir = join(root, 'assets', 'icons');

/** Reduz pela metade em passos sucessivos para evitar serrilhado. */
function downscale(img: Image, size: number): Canvas {
  let src: Image | Canvas = img;
  let w = img.width;
  let h = img.height;
  while (w / 2 >= size && h / 2 >= size) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = createCanvas(w, h);
    const ctx = step.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    src = step;
  }
  const out = createCanvas(size, size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size, size);
  return out;
}

/** Remove o fundo branco ligado às bordas (flood fill 4-vizinhos) e suaviza a borda. */
function clearBackground(canvas: Canvas): Canvas {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const isBg = (i: number) => {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    return Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const k = stack.pop()!;
    if (seen[k] || !isBg(k * 4)) continue;
    seen[k] = 1;
    const x = k % w;
    const y = (k - x) / w;
    if (x > 0) stack.push(k - 1);
    if (x < w - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - w);
    if (y < h - 1) stack.push(k + w);
  }
  for (let k = 0; k < w * h; k++) {
    if (seen[k]) {
      d[k * 4 + 3] = 0;
      continue;
    }
    // Borda: pixel claro vizinho do fundo fica parcialmente transparente.
    const x = k % w;
    const near = (x > 0 && seen[k - 1]) || (x < w - 1 && seen[k + 1]) || seen[k - w] || seen[k + w];
    if (!near) continue;
    const lum = (d[k * 4]! + d[k * 4 + 1]! + d[k * 4 + 2]!) / 3;
    if (lum > 190) d[k * 4 + 3] = Math.round(255 * Math.min(1, (255 - lum) / 65));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let count = 0;
for (const category of readdirSync(iconsDir)) {
  const masterDir = join(iconsDir, category, 'master');
  if (!existsSync(masterDir)) continue;
  for (const file of readdirSync(masterDir)) {
    if (!file.endsWith('.png')) continue;
    const img = await loadImage(join(masterDir, file));
    const out = join(iconsDir, category, file);
    writeFileSync(out, clearBackground(downscale(img, SIZE)).toBuffer('image/png'));
    console.log(`  ${category}/${file}: ${img.width}×${img.height} → ${SIZE}×${SIZE}`);
    count++;
  }
}
console.log(`${count} ícone(s) gerado(s).`);
