/**
 * Renderiza um GameState em PNG usando o mesmo renderer do Combat Debug Lab
 * (apps/combat-debug-lab/src/render.ts), sobre um canvas Node (@napi-rs/canvas).
 *
 * Os screenshots servem para inspeção humana; a validação continua sendo feita pelo estado.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Catalog, GameState } from '@bardurinho/domain';
import { render, type Layers } from '../../apps/combat-debug-lab/src/render.js';

/** Tipo do contexto esperado pelo renderer do lab (CanvasRenderingContext2D do DOM). */
type LabContext = Parameters<typeof render>[0];

export const SCREENSHOT_LAYERS: Layers = {
  terrain: true,
  surface: true,
  objects: true,
  units: true,
  coordinates: true,
  movementCost: false,
  reachable: false,
  lineOfSight: false,
  attackRange: false,
};

export interface ScreenshotOptions {
  /** Texto da barra de legenda (ex.: "surfaces/oil_ignition — before"). Sem legenda se omitido. */
  caption?: string;
  /** Andares a desenhar (padrão: todos, empilhados verticalmente). */
  floors?: number[];
}

const CAPTION_H = 26;
const FLOOR_LABEL_H = 18;
const BG = '#1a1b1e';

function renderFloor(state: GameState, catalog: Catalog, floor: number) {
  // O renderer redimensiona o próprio canvas conforme o mapa.
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  render(ctx as unknown as LabContext, {
    state,
    catalog,
    floor,
    layers: SCREENSHOT_LAYERS,
    selectedCell: null,
    selectedUnitId: null,
    hoverCell: null,
    rangePreview: null,
  });
  return canvas;
}

function drawBar(ctx: SKRSContext2D, text: string, y: number, h: number, width: number, font: string, color: string): void {
  ctx.fillStyle = '#25262b';
  ctx.fillRect(0, y, width, h);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 6, y + h / 2, width - 12);
}

/** Renderiza o estado em PNG (Buffer). */
export function renderStateToPng(state: GameState, catalog: Catalog, options: ScreenshotOptions = {}): Buffer {
  const floors = options.floors ?? Array.from({ length: state.map.floors }, (_, i) => i);
  const parts = floors.map((f) => ({ floor: f, canvas: renderFloor(state, catalog, f) }));
  const labelFloors = parts.length > 1;
  const width = Math.max(...parts.map((p) => p.canvas.width), 320);
  const captionH = options.caption ? CAPTION_H : 0;
  const height = captionH + parts.reduce((h, p) => h + p.canvas.height + (labelFloors ? FLOOR_LABEL_H : 0), 0);

  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  if (options.caption) {
    drawBar(ctx, options.caption, 0, CAPTION_H, width, 'bold 13px sans-serif', '#e9ecef');
    y += CAPTION_H;
  }
  for (const p of parts) {
    if (labelFloors) {
      drawBar(ctx, `andar ${p.floor}`, y, FLOOR_LABEL_H, width, '11px sans-serif', '#adb5bd');
      y += FLOOR_LABEL_H;
    }
    ctx.drawImage(p.canvas, 0, y);
    y += p.canvas.height;
  }
  return out.toBuffer('image/png');
}
