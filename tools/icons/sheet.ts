/**
 * Folha de contato dos ícones: cada ícone a 128 px e a 40 px, com o id.
 * Saída: docs/screenshots/fase-04/icones.png (+ icones-32px-zoom.png, 32 px ampliado 3×).
 *
 * Uso: npm run icons:sheet   (depois de `npm run icons:svg`)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { icons } from '@bardurinho/assets-manifest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'docs', 'screenshots', 'fase-04');
mkdirSync(outDir, { recursive: true });

/** Carrega o ícone rasterizado no tamanho pedido (SVG é reamostrado no vetor). */
async function load(path: string, size: number): Promise<Image> {
  const file = join(root, 'assets', path);
  if (!path.endsWith('.svg')) return loadImage(file);
  const svg = readFileSync(file, 'utf8').replace('width="256" height="256"', `width="${size}" height="${size}"`);
  return loadImage(Buffer.from(svg));
}

function checker(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, c = 8) {
  for (let j = 0; j < h / c; j++) for (let i = 0; i < w / c; i++) {
    ctx.fillStyle = (i + j) % 2 ? '#2a2f3a' : '#323845';
    ctx.fillRect(x + i * c, y + j * c, Math.min(c, w - i * c), Math.min(c, h - j * c));
  }
}

const entries = Object.entries(icons).filter(([id]) => !id.startsWith('icon.unassigned'));
const COLS = 7, CW = 220, CH = 200;
const rows = Math.ceil(entries.length / COLS);
const canvas = createCanvas(COLS * CW, rows * CH + 40);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#1b1f27';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#e8e8f0';
ctx.font = 'bold 20px sans-serif';
ctx.fillText(`Bardurinho RPG — ícones (${entries.length}) · 128 px e 40 px`, 16, 28);

for (const [k, [id, path]] of entries.entries()) {
  const x = (k % COLS) * CW, y = Math.floor(k / COLS) * CH + 40;
  checker(ctx, x + 8, y + 8, 128, 128);
  ctx.drawImage(await load(path, 128), x + 8, y + 8, 128, 128);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(x + 150, y + 20, 56, 56);
  ctx.drawImage(await load(path, 40), x + 158, y + 28, 40, 40);
  checker(ctx, x + 150, y + 84, 56, 56);
  ctx.drawImage(await load(path, 40), x + 158, y + 92, 40, 40);
  ctx.fillStyle = '#cfd3dc';
  ctx.font = '13px sans-serif';
  ctx.fillText(id.replace(/^icon\./, ''), x + 8, y + 160, CW - 16);
  ctx.fillStyle = '#7f8796';
  ctx.font = '11px sans-serif';
  ctx.fillText(path.replace(/^icons\//, ''), x + 8, y + 178, CW - 16);
}
writeFileSync(join(outDir, 'icones.png'), canvas.toBuffer('image/png'));

// Zoom 3× de 32 px (vizinho mais próximo) para conferir a leitura em tamanho de HUD.
const zoomIds = ['icon.flame', 'icon.hide', 'icon.thorns', 'icon.root', 'icon.status.burning', 'icon.status.slowed', 'icon.status.rooted', 'icon.status.hidden', 'icon.status.barrier', 'icon.action.cooldown', 'icon.item.consumable.health_potion', 'icon.class.rogue'];
const Z = 96, zc = createCanvas(zoomIds.length * (Z + 12) + 12, Z + 24);
const zctx = zc.getContext('2d');
zctx.fillStyle = '#1b1f27';
zctx.fillRect(0, 0, zc.width, zc.height);
zctx.imageSmoothingEnabled = false;
for (const [k, id] of zoomIds.entries()) {
  const small = createCanvas(32, 32);
  small.getContext('2d').drawImage(await load(icons[id as keyof typeof icons], 32), 0, 0, 32, 32);
  checker(zctx, 12 + k * (Z + 12), 12, Z, Z, 12);
  zctx.drawImage(small, 12 + k * (Z + 12), 12, Z, Z);
}
writeFileSync(join(outDir, 'icones-32px-zoom.png'), zc.toBuffer('image/png'));
console.log(`Folha de contato: docs/screenshots/fase-04/icones.png (${entries.length} ícones)`);
