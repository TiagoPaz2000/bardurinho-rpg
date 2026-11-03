/**
 * Visualizador 2D: Core → Game State → Debug Renderer → Canvas.
 * Apenas desenha; nenhuma regra é calculada aqui (as camadas de debug consultam o core).
 *
 * Layout de uma célula (46px):
 *   - fundo: terreno (chão / parede de tijolos / vazio hachurado) + véu de área escura (lua no canto sup. esq.)
 *   - superfície: textura colorida com motivos nas bordas; ícone grande no centro se a célula estiver livre
 *   - objeto: ícone grande no centro; se houver unidade junto, vira um selo pequeno no canto sup. esq.
 *   - unidade: disco da equipe com ícone da classe, anéis de turno/barreira, barra de PV no topo,
 *     selos de estado na parte de baixo
 *   - textos de debug: coordenada (inf. esq.), custo (inf. dir.), expiração da superfície (sup. dir.)
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
import {
  SURFACE_ICON,
  badgeDisc,
  drawClassIcon,
  drawDarkOverlay,
  drawFlame,
  drawObjectIcon,
  drawShieldIcon,
  drawStatusIcon,
  drawSurfaceTile,
  drawVoidTile,
  drawWallTile,
} from './icons.js';

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

const GROUND = '#2b2f36';
const TEAM_COLOR: Record<string, string> = { A: '#4dabf7', B: '#ff6b6b', dummy: '#adb5bd' };

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

  // Ocupação (somente leitura) para decidir o tamanho dos ícones em células compartilhadas.
  const objects = layers.objects ? activeObjects(state).filter((o) => o.pos.floor === floor) : [];
  const units = layers.units ? livingUnits(state).filter((u) => u.pos.floor === floor) : [];
  const unitCells = new Set(units.map((u) => `${u.pos.x},${u.pos.y}`));
  const occupied = new Set([...unitCells, ...objects.map((o) => `${o.pos.x},${o.pos.y}`)]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = { x, y, floor };
      const cell = getCell(state.map, c)!;
      const px = x * CELL;
      const py = y * CELL;
      ctx.fillStyle = GROUND;
      ctx.fillRect(px, py, CELL, CELL);
      if (layers.terrain) {
        if (cell.terrain === 'wall') drawWallTile(ctx, px, py, CELL);
        else if (cell.terrain === 'void') drawVoidTile(ctx, px, py, CELL);
      }
      if (layers.surface && cell.surface) {
        drawSurfaceTile(ctx, cell.surface.kind, px, py, CELL);
        if (!occupied.has(`${x},${y}`)) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          SURFACE_ICON[cell.surface.kind]?.(ctx, px + CELL / 2, py + CELL / 2 - 2, 22);
          ctx.restore();
        }
      }
      if (layers.terrain && cell.dark) drawDarkOverlay(ctx, px, py, CELL);
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
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      // textos de debug da célula (ficam sob objetos/unidades)
      ctx.font = '9px monospace';
      if (layers.coordinates) label(ctx, `${x},${y}`, px + 12, py + CELL - 7, '#adb5bd');
      if (layers.movementCost && cell.terrain === 'ground') label(ctx, String(enterCost(state, catalog, c)), px + CELL - 7, py + CELL - 7, '#ffd43b');
    }
  }

  for (const obj of objects) {
    const px = obj.pos.x * CELL;
    const py = obj.pos.y * CELL;
    const shared = unitCells.has(`${obj.pos.x},${obj.pos.y}`);
    if (shared) {
      // Selo pequeno no canto superior esquerdo: a unidade ocupa o centro.
      badgeDisc(ctx, px + 10, py + 10, 9, '#ced4da');
      drawObjectIcon(ctx, obj.defId, px + 10, py + 10, 15, { state: obj.state });
      if (obj.burning) drawFlame(ctx, px + 18, py + 17, 10);
    } else {
      drawObjectIcon(ctx, obj.defId, px + CELL / 2, py + CELL / 2, 32, { state: obj.state });
      if (obj.burning) {
        badgeDisc(ctx, px + CELL - 10, py + CELL - 14, 7, '#ff922b');
        drawFlame(ctx, px + CELL - 10, py + CELL - 14, 11);
      }
    }
    if (obj.hp !== null && obj.maxHp) bar(ctx, px, py + CELL - 5, obj.hp / obj.maxHp, '#fab005');
  }

  for (const u of units) {
    const cx = u.pos.x * CELL + CELL / 2;
    const cy = u.pos.y * CELL + CELL / 2 + 1;
    const r = CELL * 0.3;
    const team = TEAM_COLOR[u.team] ?? '#e599f7';
    if (state.turn.activeUnitId === u.id) {
      // destaque de turno ativo: halo amarelo
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 212, 59, 0.3)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd43b';
      ctx.stroke();
      ctx.restore();
    }
    // disco da equipe: anel escuro para separar da superfície
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = team;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    if (u.shield) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
      ctx.setLineDash([4, 2.5]);
      ctx.strokeStyle = '#91a7ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
    drawClassIcon(ctx, u.classId, !!u.flags.isDummy, cx, cy, r * 1.4);
    bar(ctx, u.pos.x * CELL, u.pos.y * CELL + 1, u.hp / u.maxHp, '#51cf66');
    if (u.statuses.length) {
      const n = u.statuses.length;
      const gap = 11;
      const by = u.pos.y * CELL + CELL - 8;
      u.statuses.forEach((s, i) => {
        const bx = cx + (i - (n - 1) / 2) * gap;
        badgeDisc(ctx, bx, by, 5.5, '#ced4da');
        drawStatusIcon(ctx, s.statusId, bx, by, 9);
      });
    }
  }

  // Expiração da superfície por cima de tudo, em pílula escura.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '9px monospace';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = getCell(state.map, { x, y, floor })!;
      const px = x * CELL;
      const py = y * CELL;
      if (layers.surface && cell.surface && cell.surface.expiresAtRound !== null) {
        const text = `→R${cell.surface.expiresAtRound}`;
        const w = ctx.measureText(text).width + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(px + CELL - w - 1, py + 7, w, 10);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, px + CELL - 1 - w / 2, py + 12.5);
      }
    }
  }

  outline(ctx, input.hoverCell, floor, 'rgba(255,255,255,0.4)');
  outline(ctx, input.selectedCell, floor, '#ffd43b');
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.lineWidth = 1;
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

// ---------------------------------------------------------------------------
// Legenda (opcional; main.ts pode anexar `renderLegend()` à interface)
// ---------------------------------------------------------------------------

type LegendDraw = (ctx: CanvasRenderingContext2D, size: number) => void;

export interface LegendEntry {
  group: 'Terreno' | 'Superfícies' | 'Objetos' | 'Unidades' | 'Estados';
  label: string;
  draw: LegendDraw;
}

const S = 28;
const mid = S / 2;
const unitDisc = (team: string, classId: string | null, dummy = false): LegendDraw => (ctx) => {
  ctx.beginPath();
  ctx.arc(mid, mid, S * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_COLOR[team] ?? '#e599f7';
  ctx.fill();
  drawClassIcon(ctx, classId, dummy, mid, mid, S * 0.5);
};
const statusBadge = (id: string): LegendDraw => (ctx) => {
  badgeDisc(ctx, mid, mid, 10, '#ced4da');
  drawStatusIcon(ctx, id, mid, mid, 16);
};
const obj = (defId: string, st = 'normal'): LegendDraw => (ctx) => drawObjectIcon(ctx, defId, mid, mid, S - 4, { state: st });

export const LEGEND: LegendEntry[] = [
  { group: 'Terreno', label: 'Chão', draw: (ctx) => { ctx.fillStyle = GROUND; ctx.fillRect(0, 0, S, S); } },
  { group: 'Terreno', label: 'Parede', draw: (ctx) => drawWallTile(ctx, 0, 0, S) },
  { group: 'Terreno', label: 'Vazio', draw: (ctx) => drawVoidTile(ctx, 0, 0, S) },
  { group: 'Terreno', label: 'Área escura', draw: (ctx) => { ctx.fillStyle = GROUND; ctx.fillRect(0, 0, S, S); drawDarkOverlay(ctx, 0, 0, S); } },
  { group: 'Superfícies', label: 'Óleo', draw: (ctx) => { drawSurfaceTile(ctx, 'oil', 0, 0, S); SURFACE_ICON.oil!(ctx, mid, mid, 16); } },
  { group: 'Superfícies', label: 'Fogo', draw: (ctx) => drawSurfaceTile(ctx, 'fire', 0, 0, S) },
  { group: 'Superfícies', label: 'Espinhos', draw: (ctx) => drawSurfaceTile(ctx, 'thorns', 0, 0, S) },
  { group: 'Objetos', label: 'Porta fechada', draw: obj('door', 'closed') },
  { group: 'Objetos', label: 'Porta aberta', draw: obj('door', 'open') },
  { group: 'Objetos', label: 'Portão fechado', draw: obj('gate', 'closed') },
  { group: 'Objetos', label: 'Portão aberto', draw: obj('gate', 'open') },
  { group: 'Objetos', label: 'Alavanca', draw: obj('lever', 'closed') },
  { group: 'Objetos', label: 'Barril explosivo', draw: obj('barrel') },
  { group: 'Objetos', label: 'Caixa', draw: obj('crate') },
  { group: 'Objetos', label: 'Cisterna', draw: obj('cistern') },
  { group: 'Objetos', label: 'Baú', draw: obj('chest') },
  { group: 'Objetos', label: 'Baú usado', draw: obj('chest', 'used') },
  { group: 'Objetos', label: 'Altar de Foco', draw: obj('focus_altar') },
  { group: 'Objetos', label: 'Queimando', draw: (ctx) => { badgeDisc(ctx, mid, mid, 10, '#ff922b'); drawFlame(ctx, mid, mid, 16); } },
  { group: 'Unidades', label: 'Mago', draw: unitDisc('A', 'mage') },
  { group: 'Unidades', label: 'Ladino', draw: unitDisc('A', 'rogue') },
  { group: 'Unidades', label: 'Guerreiro', draw: unitDisc('B', 'warrior') },
  { group: 'Unidades', label: 'Druida', draw: unitDisc('B', 'druid') },
  { group: 'Unidades', label: 'Boneco de teste', draw: unitDisc('dummy', null, true) },
  { group: 'Unidades', label: 'Barreira', draw: (ctx) => drawShieldIcon(ctx, mid, mid, S) },
  { group: 'Estados', label: 'Queimando', draw: statusBadge('burning') },
  { group: 'Estados', label: 'Lentidão', draw: statusBadge('slowed') },
  { group: 'Estados', label: 'Enraizado', draw: statusBadge('rooted') },
  { group: 'Estados', label: 'Oculto', draw: statusBadge('hidden') },
];

/** Monta um painel HTML com a legenda dos ícones (classe CSS `.legend`). */
export function renderLegend(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'legend';
  const groups = new Map<string, HTMLElement>();
  for (const entry of LEGEND) {
    let list = groups.get(entry.group);
    if (!list) {
      const title = document.createElement('div');
      title.className = 'legend-group';
      title.textContent = entry.group;
      list = document.createElement('div');
      list.className = 'legend-list';
      root.append(title, list);
      groups.set(entry.group, list);
    }
    const item = document.createElement('div');
    item.className = 'legend-item';
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (ctx) entry.draw(ctx, S);
    const text = document.createElement('span');
    text.textContent = entry.label;
    item.append(canvas, text);
    list.append(item);
  }
  return root;
}
