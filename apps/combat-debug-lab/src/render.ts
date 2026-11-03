/**
 * Visualizador 2D: Core → Game State → Debug Renderer → Canvas.
 * Apenas desenha; nenhuma regra é calculada aqui (as camadas de debug consultam o core).
 */
import {
  activeObjects,
  coordKey,
  enterCost,
  getCell,
  hasLineOfSight,
  livingUnits,
  reachableCells,
  type Catalog,
  type Coord,
  type GameState,
} from '@bardurinho/domain';

export const CELL = 46;

export interface Layers {
  terrain: boolean;
  surface: boolean;
  objects: boolean;
  units: boolean;
  coordinates: boolean;
  movementCost: boolean;
  reachable: boolean;
  lineOfSight: boolean;
  attackRange: boolean;
}

export interface RenderInput {
  state: GameState;
  catalog: Catalog;
  floor: number;
  layers: Layers;
  selectedCell: Coord | null;
  selectedUnitId: string | null;
  hoverCell: Coord | null;
  /** Alcance da ação armada (destacado em amarelo). */
  rangePreview: { min: number; max: number } | null;
}

const TERRAIN_COLOR = { ground: '#2b2f36', wall: '#6c6f75', void: '#0b0c0e' } as const;
const SURFACE_COLOR = { oil: 'rgba(120, 84, 24, 0.85)', fire: 'rgba(232, 89, 12, 0.85)', thorns: 'rgba(47, 158, 68, 0.8)' } as const;
const TEAM_COLOR: Record<string, string> = { A: '#4dabf7', B: '#ff6b6b', dummy: '#adb5bd' };
const CLASS_LETTER: Record<string, string> = { mage: 'M', rogue: 'L', warrior: 'G', druid: 'D' };
const OBJECT_GLYPH: Record<string, string> = {
  door: '🚪', gate: '▦', lever: '⫯', barrel: '🛢', crate: '▣', cistern: '≋', chest: '$', focus_altar: '✦',
};

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { state, catalog, floor, layers } = input;
  const { width, height } = state.map;
  ctx.canvas.width = width * CELL;
  ctx.canvas.height = height * CELL;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const selectedUnit = input.selectedUnitId ? state.units[input.selectedUnitId] : undefined;
  const reach =
    layers.reachable && selectedUnit?.alive && selectedUnit.pos.floor === floor
      ? reachableCells(state, catalog, selectedUnit.pos, selectedUnit.mp)
      : null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = { x, y, floor };
      const cell = getCell(state.map, c)!;
      const px = x * CELL;
      const py = y * CELL;
      ctx.fillStyle = layers.terrain ? TERRAIN_COLOR[cell.terrain] : '#2b2f36';
      ctx.fillRect(px, py, CELL, CELL);
      if (layers.terrain && cell.dark) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px, py, CELL, CELL);
      }
      if (layers.surface && cell.surface) {
        ctx.fillStyle = SURFACE_COLOR[cell.surface.kind];
        ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
        if (cell.surface.expiresAtRound !== null) {
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.fillText(`→R${cell.surface.expiresAtRound}`, px + CELL - 14, py + 8);
        }
      }
      if (reach?.has(coordKey(c))) {
        ctx.fillStyle = 'rgba(77, 171, 247, 0.18)';
        ctx.fillRect(px, py, CELL, CELL);
      }
      if (input.rangePreview && selectedUnit && cell.terrain !== 'wall') {
        const d = Math.abs(selectedUnit.pos.x - x) + Math.abs(selectedUnit.pos.y - y) + 2 * Math.abs(selectedUnit.pos.floor - floor);
        if (d >= input.rangePreview.min && d <= input.rangePreview.max) {
          ctx.fillStyle = 'rgba(250, 210, 50, 0.16)';
          ctx.fillRect(px, py, CELL, CELL);
        }
      }
      if (layers.lineOfSight && selectedUnit && cell.terrain === 'ground' && selectedUnit.pos.floor === floor) {
        if (!hasLineOfSight(state, catalog, selectedUnit.pos, c)) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(px, py, CELL, CELL);
        }
      }
      ctx.strokeStyle = '#1a1c20';
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#868e96';
      if (layers.coordinates) ctx.fillText(`${x},${y}`, px + 12, py + CELL - 7);
      if (layers.movementCost && cell.terrain === 'ground') {
        ctx.fillStyle = '#ffd43b';
        ctx.fillText(String(enterCost(state, catalog, c)), px + CELL - 7, py + CELL - 7);
      }
    }
  }

  if (layers.objects) {
    for (const obj of activeObjects(state)) {
      if (obj.pos.floor !== floor) continue;
      const px = obj.pos.x * CELL;
      const py = obj.pos.y * CELL;
      ctx.font = '22px sans-serif';
      ctx.globalAlpha = obj.state === 'open' ? 0.35 : 1;
      ctx.fillStyle = '#e9ecef';
      ctx.fillText(OBJECT_GLYPH[obj.defId] ?? '?', px + CELL / 2, py + CELL / 2);
      ctx.globalAlpha = 1;
      if (obj.burning) {
        ctx.font = '12px sans-serif';
        ctx.fillText('🔥', px + CELL - 9, py + 9);
      }
      if (obj.hp !== null && obj.maxHp) bar(ctx, px, py + CELL - 5, obj.hp / obj.maxHp, '#fab005');
    }
  }

  if (layers.units) {
    for (const u of livingUnits(state)) {
      if (u.pos.floor !== floor) continue;
      const cx = u.pos.x * CELL + CELL / 2;
      const cy = u.pos.y * CELL + CELL / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLOR[u.team] ?? '#e599f7';
      ctx.fill();
      if (state.turn.activeUnitId === u.id) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd43b';
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (u.shield) {
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
        ctx.strokeStyle = '#91a7ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = '#111';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(u.flags.isDummy ? 'T' : CLASS_LETTER[u.classId ?? ''] ?? '?', cx, cy);
      bar(ctx, u.pos.x * CELL, u.pos.y * CELL + 1, u.hp / u.maxHp, '#51cf66');
      if (u.statuses.length) {
        ctx.font = '9px monospace';
        ctx.fillStyle = '#ffa8a8';
        ctx.fillText(u.statuses.map((s) => s.statusId.slice(0, 3)).join(' '), cx, u.pos.y * CELL + CELL - 5);
      }
    }
  }

  outline(ctx, input.hoverCell, floor, 'rgba(255,255,255,0.4)');
  outline(ctx, input.selectedCell, floor, '#ffd43b');
}

function bar(ctx: CanvasRenderingContext2D, px: number, py: number, ratio: number, color: string): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(px + 4, py, CELL - 8, 4);
  ctx.fillStyle = color;
  ctx.fillRect(px + 4, py, Math.max(0, (CELL - 8) * Math.min(1, ratio)), 4);
}

function outline(ctx: CanvasRenderingContext2D, c: Coord | null, floor: number, color: string): void {
  if (!c || c.floor !== floor) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
  ctx.lineWidth = 1;
}
