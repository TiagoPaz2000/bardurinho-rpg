/**
 * Gera as versões web (256×256, seção 7.3 do plano) a partir das imagens-mestre.
 *
 * Para cada `assets/icons/<categoria>/master/<nome>.png` escreve
 * `assets/icons/<categoria>/<nome>.png`. As mestres nunca são alteradas.
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

let count = 0;
for (const category of readdirSync(iconsDir)) {
  const masterDir = join(iconsDir, category, 'master');
  if (!existsSync(masterDir)) continue;
  for (const file of readdirSync(masterDir)) {
    if (!file.endsWith('.png')) continue;
    const img = await loadImage(join(masterDir, file));
    const out = join(iconsDir, category, file);
    writeFileSync(out, downscale(img, SIZE).toBuffer('image/png'));
    console.log(`  ${category}/${file}: ${img.width}×${img.height} → ${SIZE}×${SIZE}`);
    count++;
  }
}
console.log(`${count} ícone(s) gerado(s).`);
