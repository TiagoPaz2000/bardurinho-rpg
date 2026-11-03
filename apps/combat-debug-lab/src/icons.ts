/**
 * Ícones procedurais (Canvas 2D) do Combat Debug Lab.
 * Sem imagens nem emoji: tudo é desenhado com paths para ficar idêntico em qualquer SO.
 * Convenção: cada ícone recebe o centro (cx, cy) e o tamanho `s` da caixa quadrada.
 */

export type IconFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void;

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function withStyle(ctx: CanvasRenderingContext2D, fn: () => void): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn();
  ctx.restore();
}

/** Disco escuro usado como fundo de selos (badges) pequenos. */
export function badgeDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ring = '#000'): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16,18,22,0.92)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

/** Chama genérica (usada por superfície, status e selo de objeto queimando). */
export function drawFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, outer = '#ff6b00', inner = '#ffd43b'): void {
  withStyle(ctx, () => {
    const h = s * 0.5;
    const w = s * 0.34;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.bezierCurveTo(cx + w * 0.4, cy - h * 0.35, cx + w, cy - h * 0.1, cx + w * 0.9, cy + h * 0.35);
    ctx.bezierCurveTo(cx + w * 0.8, cy + h * 0.85, cx - w * 0.8, cy + h * 0.85, cx - w * 0.9, cy + h * 0.35);
    ctx.bezierCurveTo(cx - w, cy - h * 0.05, cx - w * 0.3, cy - h * 0.2, cx, cy - h);
    ctx.fillStyle = outer;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - h * 0.15);
    ctx.bezierCurveTo(cx + w * 0.5, cy + h * 0.2, cx + w * 0.45, cy + h * 0.7, cx, cy + h * 0.7);
    ctx.bezierCurveTo(cx - w * 0.45, cy + h * 0.7, cx - w * 0.5, cy + h * 0.2, cx, cy - h * 0.15);
    ctx.fillStyle = inner;
    ctx.fill();
  });
}

/** Gota (lágrima): ponta em cima, círculo embaixo. */
function drawDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string, stroke: string): void {
  withStyle(ctx, () => {
    const r = s * 0.28;
    const oy = cy + s * 0.18; // centro do círculo
    const tipY = cy - s * 0.48;
    const phi = Math.acos(r / (oy - tipY));
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.arc(cx, oy, r, -Math.PI / 2 + phi, (3 * Math.PI) / 2 - phi);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, s * 0.07);
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, oy - r * 0.25, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
  });
}

function drawSpike(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Terreno (desenhado sobre a célula inteira: px, py = canto superior esquerdo)
// ---------------------------------------------------------------------------

/** Parede: padrão de tijolos. */
export function drawWallTile(ctx: CanvasRenderingContext2D, px: number, py: number, size: number): void {
  withStyle(ctx, () => {
    ctx.fillStyle = '#7a6f66';
    ctx.fillRect(px, py, size, size);
    const rows = 4;
    const rh = size / rows;
    ctx.fillStyle = '#8d8178';
    for (let r = 0; r < rows; r++) {
      const off = r % 2 === 0 ? 0 : size / 4;
      for (let bx = -size / 2 + off; bx < size; bx += size / 2) {
        const x0 = Math.max(px, px + bx + 1);
        const x1 = Math.min(px + size, px + bx + size / 2 - 1);
        if (x1 > x0) ctx.fillRect(x0, py + r * rh + 1, x1 - x0, rh - 2);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + size - 3, size, 3);
  });
}

/** Vazio: fundo quase preto com hachura diagonal. */
export function drawVoidTile(ctx: CanvasRenderingContext2D, px: number, py: number, size: number): void {
  withStyle(ctx, () => {
    ctx.fillStyle = '#08090b';
    ctx.fillRect(px, py, size, size);
    ctx.beginPath();
    ctx.rect(px, py, size, size);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 70, 70, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let d = -size; d < size; d += 9) {
      ctx.moveTo(px + d, py + size);
      ctx.lineTo(px + d + size, py);
    }
    ctx.stroke();
  });
}

/** Área escura: véu azulado + lua crescente no canto superior esquerdo. */
export function drawDarkOverlay(ctx: CanvasRenderingContext2D, px: number, py: number, size: number): void {
  withStyle(ctx, () => {
    ctx.fillStyle = 'rgba(10, 12, 40, 0.5)';
    ctx.fillRect(px, py, size, size);
    drawMoon(ctx, px + 8, py + 9, 11);
  });
}

export const drawMoon: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    const r = s * 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.3, Math.PI * 1.7);
    ctx.arc(cx + r * 0.55, cy - r * 0.15, r * 0.8, Math.PI * 1.55, Math.PI * 0.45, true);
    ctx.closePath();
    ctx.fillStyle = '#bac8ff';
    ctx.fill();
  });
};

// ---------------------------------------------------------------------------
// Superfícies
// ---------------------------------------------------------------------------

export const SURFACE_TINT = {
  oil: 'rgba(92, 64, 20, 0.9)',
  fire: 'rgba(200, 60, 8, 0.8)',
  thorns: 'rgba(36, 120, 52, 0.85)',
} as const;

/**
 * Textura da superfície sobre a célula inteira. Os motivos ficam nas bordas
 * para continuarem visíveis mesmo com unidade/objeto no centro.
 */
export function drawSurfaceTile(ctx: CanvasRenderingContext2D, kind: keyof typeof SURFACE_TINT, px: number, py: number, size: number): void {
  withStyle(ctx, () => {
    ctx.fillStyle = SURFACE_TINT[kind];
    ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    if (kind === 'oil') {
      // manchas brilhantes de óleo
      ctx.fillStyle = 'rgba(20, 12, 4, 0.55)';
      ctx.beginPath();
      ctx.ellipse(px + size * 0.3, py + size * 0.72, size * 0.22, size * 0.1, 0, 0, Math.PI * 2);
      ctx.ellipse(px + size * 0.72, py + size * 0.3, size * 0.18, size * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 220, 140, 0.35)';
      ctx.beginPath();
      ctx.ellipse(px + size * 0.26, py + size * 0.69, size * 0.07, size * 0.025, 0, 0, Math.PI * 2);
      ctx.ellipse(px + size * 0.69, py + size * 0.28, size * 0.06, size * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'fire') {
      // labaredas na borda inferior
      for (let i = 0; i < 4; i++) {
        const fx = px + size * (0.14 + i * 0.24);
        drawFlame(ctx, fx, py + size - 8, i % 2 ? 11 : 14, '#ff8c1a', '#ffe066');
      }
    } else {
      // espinhos nas bordas superior e inferior
      for (let i = 0; i < 5; i++) {
        const sx = px + size * (0.1 + i * 0.2);
        drawSpike(ctx, sx, py + size - 2, 6, 8, '#a9e34b');
        drawSpike(ctx, sx + size * 0.1, py + size - 2, 4, 5, '#5c940d');
      }
      ctx.save();
      ctx.translate(px + size / 2, py + 2);
      ctx.scale(1, -1);
      for (let i = 0; i < 4; i++) drawSpike(ctx, -size * 0.3 + i * size * 0.2, 0, 4, 5, '#8ce99a');
      ctx.restore();
    }
  });
}

/** Ícone da superfície em tamanho de ícone (centro da célula vazia e legenda). */
export const SURFACE_ICON: Record<string, IconFn> = {
  oil: (ctx, cx, cy, s) => {
    ctx.fillStyle = 'rgba(20, 12, 4, 0.75)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.4, s * 0.42, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    drawDrop(ctx, cx, cy - s * 0.04, s * 0.85, '#2a1a06', '#e8b04a');
  },
  fire: (ctx, cx, cy, s) => drawFlame(ctx, cx, cy, s),
  thorns: (ctx, cx, cy, s) => {
    withStyle(ctx, () => {
      const base = cy + s * 0.4;
      drawSpike(ctx, cx - s * 0.28, base, s * 0.3, s * 0.55, '#5c940d');
      drawSpike(ctx, cx + s * 0.28, base, s * 0.3, s * 0.55, '#5c940d');
      drawSpike(ctx, cx, base, s * 0.36, s * 0.85, '#a9e34b');
      ctx.fillStyle = '#2b8a3e';
      ctx.fillRect(cx - s * 0.45, base - 2, s * 0.9, 3);
    });
  },
};

// ---------------------------------------------------------------------------
// Objetos do mapa
// ---------------------------------------------------------------------------

export interface ObjectLook {
  state: string;
}

type ObjectIconFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, look: ObjectLook) => void;

const WOOD = '#a0672c';
const WOOD_DARK = '#5c3a17';
const METAL = '#adb5bd';
const METAL_DARK = '#495057';

const drawDoor: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    const w = s * 0.6;
    const h = s * 0.86;
    const x = cx - w / 2;
    const y = cy - h / 2;
    // batente
    ctx.fillStyle = '#343a40';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 2);
    if (state === 'open') {
      // vão aberto (escuro) + folha girada em perspectiva
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w * 0.38, y + h * 0.1);
      ctx.lineTo(x + w * 0.38, y + h * 0.95);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fillStyle = WOOD;
      ctx.fill();
      ctx.strokeStyle = WOOD_DARK;
      ctx.lineWidth = 1;
      ctx.stroke();
      // seta indicando passagem livre
      ctx.strokeStyle = '#69db7c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.55, cy);
      ctx.lineTo(x + w * 0.95, cy);
      ctx.moveTo(x + w * 0.8, cy - 4);
      ctx.lineTo(x + w * 0.95, cy);
      ctx.lineTo(x + w * 0.8, cy + 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = WOOD;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = WOOD_DARK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(x + (w * i) / 3, y + 1);
        ctx.lineTo(x + (w * i) / 3, y + h - 1);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(x + w * 0.78, cy + 1, Math.max(1.5, s * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  });
};

const drawGate: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    const w = s * 0.8;
    const h = s * 0.8;
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.fillStyle = '#343a40';
    ctx.fillRect(x - 2, y - 2, w + 4, 4);
    const barsH = state === 'open' ? h * 0.25 : h;
    ctx.strokeStyle = METAL;
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const bx = x + (w * (i + 0.5)) / 5;
      ctx.moveTo(bx, y);
      ctx.lineTo(bx, y + barsH);
    }
    ctx.moveTo(x, y + barsH * 0.45);
    ctx.lineTo(x + w, y + barsH * 0.45);
    ctx.stroke();
    if (state === 'open') {
      // portão erguido: seta para cima
      ctx.strokeStyle = '#69db7c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, y + h);
      ctx.lineTo(cx, y + h * 0.45);
      ctx.moveTo(cx - 5, y + h * 0.6);
      ctx.lineTo(cx, y + h * 0.45);
      ctx.lineTo(cx + 5, y + h * 0.6);
      ctx.stroke();
    } else {
      ctx.fillStyle = METAL;
      for (let i = 0; i < 5; i++) drawSpike(ctx, x + (w * (i + 0.5)) / 5, y + h + 3, 4, 4, METAL);
    }
  });
};

const drawLever: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    const baseY = cy + s * 0.3;
    const ang = state === 'open' ? Math.PI * 0.25 : -Math.PI * 0.25;
    const len = s * 0.55;
    const tx = cx + Math.sin(ang) * len;
    const ty = baseY - Math.cos(ang) * len;
    ctx.strokeStyle = METAL;
    ctx.lineWidth = Math.max(2, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = state === 'open' ? '#69db7c' : '#fa5252';
    ctx.beginPath();
    ctx.arc(tx, ty, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = METAL_DARK;
    roundRect(ctx, cx - s * 0.32, baseY - 2, s * 0.64, s * 0.16, 2);
    ctx.fill();
  });
};

const drawBarrel: ObjectIconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    const w = s * 0.6;
    const h = s * 0.82;
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y);
    ctx.lineTo(x + w * 0.88, y);
    ctx.quadraticCurveTo(x + w * 1.08, cy, x + w * 0.88, y + h);
    ctx.lineTo(x + w * 0.12, y + h);
    ctx.quadraticCurveTo(x - w * 0.08, cy, x + w * 0.12, y);
    ctx.closePath();
    ctx.fillStyle = '#c92a2a';
    ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.02, y + h * 0.22);
    ctx.lineTo(x + w * 0.98, y + h * 0.22);
    ctx.moveTo(x + w * 0.02, y + h * 0.78);
    ctx.lineTo(x + w * 0.98, y + h * 0.78);
    ctx.stroke();
    // símbolo de perigo (triângulo amarelo com "!")
    const t = s * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - t);
    ctx.lineTo(cx + t, cy + t * 0.75);
    ctx.lineTo(cx - t, cy + t * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#ffd43b';
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - 0.75, cy - t * 0.45, 1.5, t * 0.65);
    ctx.fillRect(cx - 0.75, cy + t * 0.35, 1.5, 1.5);
  });
};

const drawCrate: ObjectIconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    const w = s * 0.74;
    const x = cx - w / 2;
    const y = cy - w / 2;
    ctx.fillStyle = '#c08a4a';
    ctx.fillRect(x, y, w, w);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.strokeRect(x, y, w, w);
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + w - 2, y + w - 2);
    ctx.moveTo(x + w - 2, y + 2);
    ctx.lineTo(x + 2, y + w - 2);
    ctx.stroke();
  });
};

const drawCistern: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    const r = s * 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#868e96';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = state === 'used' ? '#343a40' : '#1c7ed6';
    ctx.fill();
    if (state !== 'used') {
      ctx.strokeStyle = '#a5d8ff';
      ctx.lineWidth = 1.5;
      for (const dy of [-r * 0.2, r * 0.2]) {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.45, cy + dy);
        ctx.quadraticCurveTo(cx - r * 0.22, cy + dy - 3, cx, cy + dy);
        ctx.quadraticCurveTo(cx + r * 0.22, cy + dy + 3, cx + r * 0.45, cy + dy);
        ctx.stroke();
      }
    }
  });
};

const drawChest: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    const w = s * 0.78;
    const h = s * 0.56;
    const x = cx - w / 2;
    const y = cy - h / 2 + s * 0.04;
    // tampa arredondada
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.4);
    ctx.quadraticCurveTo(x, y - h * 0.15, cx, y - h * 0.15);
    ctx.quadraticCurveTo(x + w, y - h * 0.15, x + w, y + h * 0.4);
    ctx.closePath();
    ctx.fillStyle = '#b5651d';
    ctx.fill();
    ctx.fillStyle = WOOD;
    ctx.fillRect(x, y + h * 0.4, w, h * 0.6);
    ctx.strokeStyle = '#f59f00';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeRect(x, y + h * 0.4, w, h * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.4);
    ctx.lineTo(x + w, y + h * 0.4);
    ctx.stroke();
    ctx.fillStyle = state === 'used' ? '#495057' : '#ffd43b';
    ctx.fillRect(cx - s * 0.07, y + h * 0.3, s * 0.14, s * 0.18);
  });
};

const drawAltar: ObjectIconFn = (ctx, cx, cy, s, { state }) => {
  withStyle(ctx, () => {
    // pedestal
    ctx.fillStyle = '#868e96';
    ctx.fillRect(cx - s * 0.38, cy + s * 0.28, s * 0.76, s * 0.14);
    ctx.fillRect(cx - s * 0.22, cy + s * 0.05, s * 0.44, s * 0.25);
    // cristal de foco
    const used = state === 'used';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.18, cy - s * 0.18);
    ctx.lineTo(cx, cy + s * 0.05);
    ctx.lineTo(cx - s * 0.18, cy - s * 0.18);
    ctx.closePath();
    ctx.fillStyle = used ? '#495057' : '#cc5de8';
    ctx.fill();
    ctx.strokeStyle = used ? '#868e96' : '#f3d9fa';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
};

const drawUnknownObject: ObjectIconFn = (ctx, cx, cy, s) => {
  ctx.fillStyle = '#e9ecef';
  ctx.font = `bold ${Math.round(s * 0.6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy);
};

const OBJECT_ICON: Record<string, ObjectIconFn> = {
  door: drawDoor,
  gate: drawGate,
  lever: drawLever,
  barrel: drawBarrel,
  crate: drawCrate,
  cistern: drawCistern,
  chest: drawChest,
  focus_altar: drawAltar,
};

/** Desenha o ícone de um objeto. Objetos já usados (`used`) ficam esmaecidos. */
export function drawObjectIcon(ctx: CanvasRenderingContext2D, defId: string, cx: number, cy: number, s: number, look: ObjectLook): void {
  ctx.save();
  if (look.state === 'used') ctx.globalAlpha = 0.45;
  (OBJECT_ICON[defId] ?? drawUnknownObject)(ctx, cx, cy, s, look);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Unidades (ícones de classe, desenhados em cor escura sobre o disco da equipe)
// ---------------------------------------------------------------------------

const INK = '#141517';

const drawMage: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    // chapéu de mago
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.12, cy - s * 0.48);
    ctx.quadraticCurveTo(cx - s * 0.05, cy - s * 0.1, cx - s * 0.26, cy + s * 0.22);
    ctx.lineTo(cx + s * 0.26, cy + s * 0.22);
    ctx.quadraticCurveTo(cx + s * 0.16, cy - s * 0.1, cx + s * 0.12, cy - s * 0.48);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.26, s * 0.46, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe066';
    star(ctx, cx + s * 0.02, cy - s * 0.02, s * 0.1);
  });
};

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const drawRogue: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    // máscara de ladrão (dominó) com os furos dos olhos
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.12);
    ctx.quadraticCurveTo(cx, cy - s * 0.36, cx + s * 0.5, cy - s * 0.12);
    ctx.quadraticCurveTo(cx + s * 0.46, cy + s * 0.22, cx + s * 0.2, cy + s * 0.22);
    ctx.quadraticCurveTo(cx + s * 0.06, cy + s * 0.22, cx, cy + s * 0.08);
    ctx.quadraticCurveTo(cx - s * 0.06, cy + s * 0.22, cx - s * 0.2, cy + s * 0.22);
    ctx.quadraticCurveTo(cx - s * 0.46, cy + s * 0.22, cx - s * 0.5, cy - s * 0.12);
    ctx.closePath();
    ctx.moveTo(cx - s * 0.12, cy - s * 0.02);
    ctx.ellipse(cx - s * 0.22, cy - s * 0.02, s * 0.1, s * 0.07, 0, 0, Math.PI * 2);
    ctx.moveTo(cx + s * 0.32, cy - s * 0.02);
    ctx.ellipse(cx + s * 0.22, cy - s * 0.02, s * 0.1, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill('evenodd');
    // capuz (arco acima da máscara)
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.02, s * 0.44, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  });
};

const drawWarrior: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    // escudo heráldico com espada
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.34, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.34, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.34, cy);
    ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.32, cx, cy + s * 0.48);
    ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.32, cx - s * 0.34, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.28);
    ctx.lineTo(cx, cy + s * 0.3);
    ctx.moveTo(cx - s * 0.16, cy - s * 0.04);
    ctx.lineTo(cx + s * 0.16, cy - s * 0.04);
    ctx.stroke();
  });
};

const drawDruid: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    // folha com nervura
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.48);
    ctx.quadraticCurveTo(s * 0.52, -s * 0.1, 0, s * 0.36);
    ctx.quadraticCurveTo(-s * 0.52, -s * 0.1, 0, -s * 0.48);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.lineTo(0, s * 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.32);
    ctx.lineTo(0, s * 0.3);
    ctx.moveTo(0, -s * 0.05);
    ctx.lineTo(s * 0.12, -s * 0.16);
    ctx.moveTo(0, s * 0.1);
    ctx.lineTo(-s * 0.12, -s * 0.01);
    ctx.stroke();
    ctx.restore();
  });
};

/** Boneco de teste: alvo (mira) com estaca. */
export const drawDummy: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#c92a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.48, cy);
    ctx.lineTo(cx + s * 0.48, cy);
    ctx.moveTo(cx, cy - s * 0.48);
    ctx.lineTo(cx, cy + s * 0.48);
    ctx.stroke();
  });
};

const drawUnknownClass: IconFn = (ctx, cx, cy, s) => {
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.round(s * 0.7)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy);
};

export const CLASS_ICON: Record<string, IconFn> = {
  mage: drawMage,
  rogue: drawRogue,
  warrior: drawWarrior,
  druid: drawDruid,
};

export function drawClassIcon(ctx: CanvasRenderingContext2D, classId: string | null, isDummy: boolean, cx: number, cy: number, s: number): void {
  (isDummy ? drawDummy : CLASS_ICON[classId ?? ''] ?? drawUnknownClass)(ctx, cx, cy, s);
}

// ---------------------------------------------------------------------------
// Estados (status) — selos pequenos
// ---------------------------------------------------------------------------

export const STATUS_ICON: Record<string, IconFn> = {
  burning: (ctx, cx, cy, s) => drawFlame(ctx, cx, cy + s * 0.05, s * 0.95),
  slowed: (ctx, cx, cy, s) => {
    // floco de neve
    withStyle(ctx, () => {
      ctx.strokeStyle = '#74c0fc';
      ctx.lineWidth = Math.max(1.2, s * 0.12);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 2;
        const dx = Math.cos(a) * s * 0.42;
        const dy = Math.sin(a) * s * 0.42;
        ctx.moveTo(cx - dx, cy - dy);
        ctx.lineTo(cx + dx, cy + dy);
      }
      ctx.stroke();
    });
  },
  rooted: (ctx, cx, cy, s) => {
    // raízes
    withStyle(ctx, () => {
      ctx.strokeStyle = '#8ce99a';
      ctx.lineWidth = Math.max(1.2, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.42);
      ctx.lineTo(cx, cy + s * 0.05);
      ctx.moveTo(cx, cy + s * 0.05);
      ctx.quadraticCurveTo(cx - s * 0.05, cy + s * 0.3, cx - s * 0.38, cy + s * 0.4);
      ctx.moveTo(cx, cy + s * 0.05);
      ctx.quadraticCurveTo(cx + s * 0.05, cy + s * 0.3, cx + s * 0.38, cy + s * 0.4);
      ctx.moveTo(cx, cy + s * 0.05);
      ctx.lineTo(cx, cy + s * 0.44);
      ctx.stroke();
    });
  },
  hidden: (ctx, cx, cy, s) => {
    // olho riscado
    withStyle(ctx, () => {
      ctx.strokeStyle = '#d0bfff';
      ctx.lineWidth = Math.max(1.1, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.44, cy);
      ctx.quadraticCurveTo(cx, cy - s * 0.42, cx + s * 0.44, cy);
      ctx.quadraticCurveTo(cx, cy + s * 0.42, cx - s * 0.44, cy);
      ctx.stroke();
      ctx.fillStyle = '#d0bfff';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff8787';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy + s * 0.4);
      ctx.lineTo(cx + s * 0.4, cy - s * 0.4);
      ctx.stroke();
    });
  },
};

export function drawStatusIcon(ctx: CanvasRenderingContext2D, statusId: string, cx: number, cy: number, s: number): void {
  const fn = STATUS_ICON[statusId];
  if (fn) return fn(ctx, cx, cy, s);
  ctx.fillStyle = '#ffa8a8';
  ctx.font = `bold ${Math.round(s * 0.8)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(statusId.charAt(0).toUpperCase(), cx, cy + 0.5);
}

/** Escudo (Barreira) — usado na legenda; no mapa vira um anel tracejado. */
export const drawShieldIcon: IconFn = (ctx, cx, cy, s) => {
  withStyle(ctx, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
    ctx.setLineDash([3, 2]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#91a7ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });
};
