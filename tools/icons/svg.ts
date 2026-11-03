/**
 * Gerador determinístico dos ícones vetoriais (seção 7.3 do plano, Fase 4).
 *
 * Escreve SVGs 256×256 (fundo transparente) em:
 *   assets/icons/abilities/<nome>.svg   — 10 habilidades
 *   assets/icons/items/<itemId>.svg     — 9 itens não-arma (as armas seguem em PNG)
 *   assets/icons/statuses/<id>.svg      — 5 estados (medalhas redondas)
 *   assets/icons/classes/<id>.svg       — 4 classes (estandartes)
 *   assets/icons/actions/<id>.svg       — 8 ações
 *
 * Estilo: "cartoon 3D" brilhante, como as armas em PNG — gradientes claro→escuro
 * de cima-esquerda para baixo-direita, contorno escuro fino da mesma matiz, reflexo
 * radial branco, acabamentos dourados e gemas roxas, sombra suave no chão.
 *
 * Uso: npm run icons:svg   (npx tsx tools/icons/svg.ts)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const iconsDir = join(root, 'assets', 'icons');

// ---------------------------------------------------------------------------
// Materiais
// ---------------------------------------------------------------------------

interface Mat { key: string; stops: [string, string, string]; line: string }
const mat = (key: string, a: string, b: string, c: string, line: string): Mat => ({ key, stops: [a, b, c], line });

const M = {
  gold: mat('gold', '#FFF0B0', '#F4B43C', '#B86A16', '#6A3A0C'),
  goldDark: mat('goldDark', '#F8D27A', '#C98424', '#7E4410', '#4E2808'),
  steel: mat('steel', '#FFFFFF', '#C3CAD3', '#7A8592', '#3C4450'),
  gem: mat('gem', '#F4C2FF', '#A63CD8', '#4E0E78', '#2E0648'),
  leather: mat('leather', '#D9A070', '#99582E', '#5A2E14', '#3A1A08'),
  leatherDark: mat('leatherDark', '#B07048', '#6E3A1C', '#3E1C0A', '#2A1006'),
  wood: mat('wood', '#E0A868', '#A86A34', '#663816', '#3E1E08'),
  cloth: mat('cloth', '#B9A0FF', '#6A48D8', '#2E1C80', '#1C0E50'),
  hood: mat('hood', '#8E7AB8', '#4C3878', '#22163E', '#120A24'),
  red: mat('red', '#FFB0B8', '#E8283E', '#7E0A1E', '#4A0610'),
  blue: mat('blue', '#C8F2FF', '#2E92EA', '#103C88', '#0A2050'),
  ice: mat('ice', '#FFFFFF', '#A6E6FF', '#3E9AD8', '#16507E'),
  green: mat('green', '#D8FFA0', '#5EC03A', '#21661C', '#123A0E'),
  leaf: mat('leaf', '#E6FFB0', '#7ACC40', '#2E7A1E', '#14420C'),
  fireOut: mat('fireOut', '#FFC24A', '#F0581E', '#A81E0A', '#5A0E04'),
  fireMid: mat('fireMid', '#FFF0A0', '#FFB22E', '#F06A1A', '#A8360A'),
  fireIn: mat('fireIn', '#FFFFFF', '#FFF6B8', '#FFD050', '#E89A20'),
  cream: mat('cream', '#FFFFFF', '#FBEFD2', '#DCC08A', '#7A5A2E'),
  skin: mat('skin', '#FFE2C4', '#F2B486', '#C27A4C', '#6E3A1C'),
  amber: mat('amber', '#FFE6A0', '#E89A24', '#8A4A0A', '#4A2404'),
  dirt: mat('dirt', '#A87850', '#6A4426', '#3A2210', '#24140A'),
  bramble: mat('bramble', '#B8D870', '#5E8A2A', '#2A4410', '#16260A'),
  thorn: mat('thorn', '#FFF0D0', '#E07A4A', '#8A2A12', '#4A1206'),
  bone: mat('bone', '#FFF8E0', '#E6CFA0', '#A8844E', '#5A4020'),
  white: mat('white', '#FFFFFF', '#F2F6FA', '#C8D2DE', '#5A6474'),
  dark: mat('dark', '#4A3A66', '#1E1430', '#0A0612', '#05030A'),
};

/** Fundos das medalhas de estado e dos estandartes de classe. */
const DISC = {
  burning: mat('d_burning', '#FFB060', '#E8461C', '#7A1606', '#4A0C02'),
  slowed: mat('d_slowed', '#A8E6FF', '#2C86DA', '#0E3472', '#081E46'),
  rooted: mat('d_rooted', '#B8E070', '#4E8E28', '#1E4410', '#102808'),
  hidden: mat('d_hidden', '#8E96AA', '#40475A', '#151824', '#0A0C14'),
  barrier: mat('d_barrier', '#D8B8FF', '#8048E8', '#2E1288', '#1A0854'),
  mage: mat('b_mage', '#8EA4FF', '#3448C8', '#141C6A', '#0A0E3C'),
  rogue: mat('b_rogue', '#7CA89A', '#2E5A4E', '#10261F', '#081410'),
  warrior: mat('b_warrior', '#FF8A80', '#C42424', '#5E0A0A', '#360404'),
  druid: mat('b_druid', '#B8E880', '#4A9630', '#1A4A12', '#0C2808'),
};

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

type Pt = [number, number];
const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
const pt = (p: Pt) => `${r1(p[0])},${r1(p[1])}`;

const circle = (cx: number, cy: number, r: number) =>
  `M${r1(cx - r)},${r1(cy)} A${r1(r)},${r1(r)} 0 1 0 ${r1(cx + r)},${r1(cy)} A${r1(r)},${r1(r)} 0 1 0 ${r1(cx - r)},${r1(cy)} Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${r1(cx - rx)},${r1(cy)} A${r1(rx)},${r1(ry)} 0 1 0 ${r1(cx + rx)},${r1(cy)} A${r1(rx)},${r1(ry)} 0 1 0 ${r1(cx - rx)},${r1(cy)} Z`;
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${r1(x + r)},${r1(y)} L${r1(x + w - r)},${r1(y)} Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)} L${r1(x + w)},${r1(y + h - r)} Q${r1(x + w)},${r1(y + h)} ${r1(x + w - r)},${r1(y + h)} L${r1(x + r)},${r1(y + h)} Q${r1(x)},${r1(y + h)} ${r1(x)},${r1(y + h - r)} L${r1(x)},${r1(y + r)} Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)} Z`;
}
const poly = (pts: Pt[]) => `M${pts.map(pt).join(' L')} Z`;

/** Polígono regular / estrela. */
function star(cx: number, cy: number, ro: number, ri: number, n: number, rot = -90): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 === 0 ? ro : ri;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts);
}
function ngon(cx: number, cy: number, r: number, n: number, rot = -90): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (i * 360) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Curva fechada suave (Catmull-Rom → Bézier) pelos pontos dados. */
function blob(pts: Pt[], t = 1): string {
  const n = pts.length;
  let d = `M${pt(pts[0]!)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * t, p1[1] + ((p2[1] - p0[1]) / 6) * t];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * t, p2[1] - ((p3[1] - p1[1]) / 6) * t];
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + ' Z';
}

/** Curva aberta amostrada (Catmull-Rom), com parâmetro por comprimento de arco. */
class Curve {
  readonly pts: Pt[] = [];
  readonly len: number[] = [0];
  constructor(ctrl: Pt[], samples = 24) {
    const c = [ctrl[0]!, ...ctrl, ctrl[ctrl.length - 1]!];
    for (let i = 1; i < c.length - 2; i++) {
      const p0 = c[i - 1]!, p1 = c[i]!, p2 = c[i + 1]!, p3 = c[i + 2]!;
      for (let s = 0; s < samples; s++) {
        const u = s / samples, u2 = u * u, u3 = u2 * u;
        const f = (k: 0 | 1) =>
          0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
        this.pts.push([f(0), f(1)]);
      }
    }
    this.pts.push(ctrl[ctrl.length - 1]!);
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!, b = this.pts[i]!;
      this.len.push(this.len[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
  }
  get total() { return this.len[this.len.length - 1]!; }
  /** Ponto, tangente e normal na fração `s` ∈ [0,1] do comprimento. */
  at(s: number): { p: Pt; t: Pt; n: Pt } {
    const target = s * this.total;
    let i = 1;
    while (i < this.len.length - 1 && this.len[i]! < target) i++;
    const a = this.pts[i - 1]!, b = this.pts[i]!;
    const seg = this.len[i]! - this.len[i - 1]! || 1;
    const u = (target - this.len[i - 1]!) / seg;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return { p: [a[0] + dx * u, a[1] + dy * u], t: [dx / l, dy / l], n: [-dy / l, dx / l] };
  }
  /** Contorno de um traço afunilado: largura w(s). */
  tapered(w: (s: number) => number, steps = 48): string {
    const L: Pt[] = [], R: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps, { p, n } = this.at(s), h = w(s) / 2;
      L.push([p[0] + n[0] * h, p[1] + n[1] * h]);
      R.push([p[0] - n[0] * h, p[1] - n[1] * h]);
    }
    return `M${[...L, ...R.reverse()].map(pt).join(' L')} Z`;
  }
  path(): string { return `M${this.pts.map(pt).join(' L')}`; }
}

/** Transforma um caminho escrito em coordenadas unitárias (só comandos absolutos M/L/C/Q/Z). */
function tf(d: string, cx: number, cy: number, sx: number, sy = sx): string {
  let k = 0;
  return d.replace(/-?\d*\.?\d+/g, (num) => {
    const v = parseFloat(num);
    return r1(k++ % 2 === 0 ? cx + v * sx : cy + v * sy);
  });
}

const UNIT = {
  /** Chama com três línguas, ponta em y=-1, base em y=1. */
  flame:
    'M0,-1 C0.1,-0.55 0.45,-0.45 0.42,-0.1 C0.55,-0.3 0.6,-0.55 0.55,-0.7 C0.85,-0.35 0.95,0.05 0.9,0.35 C0.85,0.8 0.45,1 0,1 C-0.45,1 -0.85,0.8 -0.9,0.35 C-0.95,0.05 -0.85,-0.35 -0.55,-0.7 C-0.6,-0.55 -0.55,-0.3 -0.42,-0.1 C-0.45,-0.45 -0.1,-0.55 0,-1 Z',
  /** Gota/cometa: ponta em y=-1, cabeça redonda embaixo. */
  drop: 'M0,-1 C0.25,-0.55 0.75,-0.15 0.75,0.32 C0.75,0.72 0.42,1 0,1 C-0.42,1 -0.75,0.72 -0.75,0.32 C-0.75,-0.15 -0.25,-0.55 0,-1 Z',
  /** Escudo heráldico. */
  heater: 'M-0.86,-0.86 Q0,-1.06 0.86,-0.86 L0.86,-0.12 C0.86,0.46 0.46,0.8 0,1 C-0.46,0.8 -0.86,0.46 -0.86,-0.12 Z',
  heart: 'M0,-0.45 C0,-0.85 -0.35,-1 -0.55,-1 C-0.85,-1 -1.05,-0.75 -1.05,-0.4 C-1.05,0.15 -0.4,0.6 0,0.95 C0.4,0.6 1.05,0.15 1.05,-0.4 C1.05,-0.75 0.85,-1 0.55,-1 C0.35,-1 0,-0.85 0,-0.45 Z',
  leaf: 'M0,-1 C0.62,-0.62 0.66,0.4 0,1 C-0.66,0.4 -0.62,-0.62 0,-1 Z',
  /** Cruz (sinal de +). */
  plus: 'M-0.34,-1 L0.34,-1 L0.34,-0.34 L1,-0.34 L1,0.34 L0.34,0.34 L0.34,1 L-0.34,1 L-0.34,0.34 L-1,0.34 L-1,-0.34 L-0.34,-0.34 Z',
};

// ---------------------------------------------------------------------------
// Construtor de SVG
// ---------------------------------------------------------------------------

interface PartOpts { sw?: number; gloss?: number; opacity?: number; angle?: 'diag' | 'down' | 'side' }

class Icon {
  private defs: string[] = [];
  private body: string[] = [];
  private cache = new Map<string, string>();
  private n = 0;
  constructor(readonly name: string) {}

  uid(p: string) { return `${this.name.replace(/[^a-z0-9]/gi, '_')}_${p}${this.n++}`; }
  def(s: string) { this.defs.push(s); }
  add(s: string) { this.body.push(s); return this; }

  grad(m: Mat, angle: PartOpts['angle'] = 'diag'): string {
    const key = `${m.key}:${angle}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = this.uid(m.key);
    const xy = angle === 'down' ? 'x1="0.5" y1="0" x2="0.5" y2="1"' : angle === 'side' ? 'x1="0" y1="0.5" x2="1" y2="0.5"' : 'x1="0.15" y1="0" x2="0.85" y2="1"';
    this.def(`<linearGradient id="${id}" ${xy}><stop offset="0" stop-color="${m.stops[0]}"/><stop offset="0.5" stop-color="${m.stops[1]}"/><stop offset="1" stop-color="${m.stops[2]}"/></linearGradient>`);
    this.cache.set(key, id);
    return id;
  }

  glossId(): string {
    const hit = this.cache.get('gloss');
    if (hit) return hit;
    const id = this.uid('gloss');
    this.def(`<radialGradient id="${id}" cx="0.34" cy="0.26" r="0.62"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.42" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    this.cache.set('gloss', id);
    return id;
  }

  blurId(sd: number): string {
    const key = `blur${sd}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = this.uid('blur');
    this.def(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
    this.cache.set(key, id);
    return id;
  }

  /** Forma sólida com gradiente, contorno e reflexo. */
  part(d: string, m: Mat, o: PartOpts = {}) {
    const sw = o.sw ?? 4;
    const op = o.opacity !== undefined ? ` opacity="${o.opacity}"` : '';
    this.add(`<path d="${d}" fill="url(#${this.grad(m, o.angle)})" stroke="${m.line}" stroke-width="${sw}" stroke-linejoin="round"${op}/>`);
    const g = o.gloss ?? 0.8;
    if (g > 0) this.add(`<path d="${d}" fill="url(#${this.glossId()})" opacity="${g}"/>`);
    return this;
  }

  fill(d: string, color: string, opacity = 1) {
    return this.add(`<path d="${d}" fill="${color}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`);
  }

  /** Traço com contorno (desenhado duas vezes). Cor sólida (evita gradiente em caixa degenerada). */
  line(d: string, w: number, color: string, outline: string, ow = 3, cap = 'round') {
    this.add(`<path d="${d}" fill="none" stroke="${outline}" stroke-width="${w + ow * 2}" stroke-linecap="${cap}" stroke-linejoin="round"/>`);
    return this.add(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"/>`);
  }

  /** Traço fino sem contorno (detalhes, costuras, reflexos). */
  stroke(d: string, w: number, color: string, opacity = 1, dash?: string) {
    return this.add(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${opacity < 1 ? ` opacity="${opacity}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  }

  /** Brilho especular (elipse branca girada). */
  shine(cx: number, cy: number, rx: number, ry: number, rot = -35, opacity = 0.85) {
    return this.add(`<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" transform="rotate(${rot} ${r1(cx)} ${r1(cy)})" fill="#fff" opacity="${opacity}"/>`);
  }

  /** Cintilância de 4 pontas. */
  sparkle(cx: number, cy: number, r: number, color = '#fff', opacity = 1) {
    return this.fill(star(cx, cy, r, r * 0.28, 4, -90), color, opacity);
  }

  /** Sombra suave no chão. */
  shadow(cx = 128, cy = 236, rx = 70, ry = 10, opacity = 0.28) {
    return this.add(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#1a0e24" opacity="${opacity}" filter="url(#${this.blurId(5)})"/>`);
  }

  /** Halo luminoso desfocado. */
  glow(d: string, color: string, opacity = 0.6, sd = 10) {
    return this.add(`<path d="${d}" fill="${color}" opacity="${opacity}" filter="url(#${this.blurId(sd)})"/>`);
  }

  group(transform: string, fn: () => void) {
    this.add(`<g transform="${transform}">`);
    fn();
    return this.add('</g>');
  }

  clip(d: string, fn: () => void) {
    const id = this.uid('clip');
    this.def(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    this.add(`<g clip-path="url(#${id})">`);
    fn();
    return this.add('</g>');
  }

  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">\n<defs>${this.defs.join('')}</defs>\n${this.body.join('\n')}\n</svg>\n`;
  }
}

// ---------------------------------------------------------------------------
// Peças reutilizáveis
// ---------------------------------------------------------------------------

/** Gema roxa com aro dourado. */
function gem(s: Icon, cx: number, cy: number, r: number, m: Mat = M.gem) {
  s.part(circle(cx, cy, r + r * 0.45), M.gold, { sw: Math.max(2, r * 0.25) });
  s.part(circle(cx, cy, r), m, { sw: Math.max(1.5, r * 0.18), gloss: 0 });
  s.shine(cx - r * 0.3, cy - r * 0.35, r * 0.38, r * 0.22, -35, 0.9);
}

function rivet(s: Icon, cx: number, cy: number, r = 5) {
  s.part(circle(cx, cy, r), M.gold, { sw: 2, gloss: 0 });
  s.fill(circle(cx - r * 0.3, cy - r * 0.3, r * 0.35), '#fff', 0.85);
}

function flame(s: Icon, cx: number, cy: number, sx: number, sy: number, layers = 3, sw = 4) {
  s.part(tf(UNIT.flame, cx, cy, sx, sy), M.fireOut, { sw, gloss: 0.35, angle: 'down' });
  if (layers > 1) s.part(tf(UNIT.flame, cx, cy + sy * 0.22, sx * 0.68, sy * 0.74), M.fireMid, { sw: sw * 0.5, gloss: 0, angle: 'down' });
  if (layers > 2) s.part(tf(UNIT.drop, cx, cy + sy * 0.45, sx * 0.36, sy * 0.48), M.fireIn, { sw: 0, gloss: 0, angle: 'down' });
}

function snowflake(s: Icon, cx: number, cy: number, r: number, w: number, color = '#F4FCFF', outline = M.ice.line) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    const P = (k: number): Pt => [cx + ux * r * k, cy + uy * r * k];
    d += `M${pt(P(0.12))} L${pt(P(1))} `;
    for (const [k, b] of [[0.5, 0.34], [0.78, 0.2]] as const) {
      const base = P(k);
      for (const sg of [-1, 1]) {
        const aa = a + (sg * 50 * Math.PI) / 180;
        d += `M${pt(base)} L${pt([base[0] + Math.cos(aa) * r * b, base[1] + Math.sin(aa) * r * b])} `;
      }
    }
  }
  s.line(d.trim(), w, color, outline, Math.max(2, w * 0.35));
  s.part(poly(ngon(cx, cy, r * 0.2, 6)), M.ice, { sw: Math.max(2, w * 0.35), gloss: 0.6 });
}

/** Frasco de vidro com líquido. `body` = contorno do vidro, `liquid` = região do líquido. */
function flask(s: Icon, body: string, liquidTop: number, liquid: Mat, inner: string) {
  s.add(`<path d="${body}" fill="#E8F4FF" fill-opacity="0.35"/>`);
  s.clip(inner, () => {
    const id = s.grad(liquid, 'down');
    s.add(`<path d="M0,${liquidTop} Q64,${liquidTop - 8} 128,${liquidTop} T256,${liquidTop} L256,256 L0,256 Z" fill="url(#${id})"/>`);
    s.add(`<path d="M0,${liquidTop} Q64,${liquidTop - 8} 128,${liquidTop} T256,${liquidTop}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="5"/>`);
    s.add(`<path d="${inner}" fill="url(#${s.glossId()})" opacity="0.5"/>`);
  });
  s.add(`<path d="${body}" fill="none" stroke="#3A2440" stroke-width="5" stroke-linejoin="round"/>`);
}

function chain(s: Icon, ctrl: Pt[], beads = 15, r = 5.5) {
  const c = new Curve(ctrl);
  for (let i = 0; i <= beads; i++) {
    const { p } = c.at(i / beads);
    s.part(circle(p[0], p[1], r), M.gold, { sw: 2.2, gloss: 0.6 });
  }
}

/** Espada vertical (lâmina para cima) centrada em x=128, de y≈14 a 238. */
function sword(s: Icon) {
  s.part('M128,14 L143,34 L143,168 L113,168 L113,34 Z', M.steel, { sw: 4 });
  s.stroke('M128,30 L128,160', 3, '#7A8592', 0.7);
  s.stroke('M121,38 L121,160', 3, '#fff', 0.75);
  s.part('M80,166 Q128,158 176,166 L172,186 Q128,180 84,186 Z', M.gold, { sw: 4 });
  gem(s, 128, 175, 6);
  s.part(rrect(119, 184, 18, 36, 5), M.leather, { sw: 3.5, gloss: 0.3 });
  s.stroke('M120,194 L136,190 M120,204 L136,200 M120,214 L136,210', 2.5, '#3A1A08', 0.8);
  s.part(circle(128, 228, 12), M.gold, { sw: 3.5 });
  s.part(circle(128, 228, 5.5), M.gem, { sw: 1.5, gloss: 0 });
}

/** Silhueta de capuz (0..1 => contorno). */
const HOOD: Pt[] = [[128, 26], [176, 46], [204, 100], [212, 172], [200, 222], [128, 234], [56, 222], [44, 172], [52, 100], [80, 46]];
const HOOD_FACE: Pt[] = [[128, 72], [160, 92], [170, 132], [156, 172], [128, 184], [100, 172], [86, 132], [96, 92]];

function scalePts(pts: Pt[], cx: number, cy: number, k: number, dx = 0, dy = 0): Pt[] {
  return pts.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]);
}

// ---------------------------------------------------------------------------
// Habilidades
// ---------------------------------------------------------------------------

const abilities: Record<string, (s: Icon) => void> = {
  flame(s) {
    s.shadow(128, 238, 60, 8, 0.2);
    s.glow(circle(156, 100, 70), '#FF8A2A', 0.45, 14);
    // Línguas secundárias do rastro (atrás da principal)
    const tails: [Pt[], number][] = [
      [[[150, 92], [110, 96], [84, 120], [50, 118], [24, 136]], 44],
      [[[160, 110], [138, 146], [112, 160], [114, 196], [96, 228]], 44],
    ];
    for (const [ctrl, w] of tails) s.part(new Curve(ctrl).tapered((t) => w * (1 - t) ** 0.9 + 0.5), M.fireOut, { sw: 4, gloss: 0, angle: 'diag' });
    s.group('rotate(-135 140 116)', () => {
      s.part(tf(UNIT.drop, 140, 96, 62, 120), M.fireOut, { sw: 4.5, gloss: 0.3, angle: 'down' });
      s.part(tf(UNIT.drop, 140, 126, 44, 88), M.fireMid, { sw: 2, gloss: 0, angle: 'down' });
      s.part(tf(UNIT.drop, 140, 154, 26, 52), M.fireIn, { sw: 0, gloss: 0, angle: 'down' });
    });
    s.fill(circle(170, 82, 22), '#fff', 0.9);
    s.shine(150, 62, 14, 7, -35, 0.8);
    for (const [x, y, r] of [[60, 108, 7], [92, 200, 6], [40, 190, 9], [200, 168, 5]] as const) {
      s.part(circle(x, y, r), M.fireMid, { sw: 2, gloss: 0 });
    }
  },

  frost_ray(s) {
    s.shadow(128, 238, 56, 8, 0.18);
    const beam = new Curve([[30, 226], [90, 166], [150, 106]]);
    s.glow(beam.tapered((t) => 14 + 40 * t), '#6FD0FF', 0.55, 10);
    s.part(beam.tapered((t) => 10 + 34 * t), M.ice, { sw: 3.5, gloss: 0, angle: 'side' });
    s.fill(new Curve([[36, 220], [92, 164], [150, 106]]).tapered((t) => 3 + 12 * t), '#fff', 0.9);
    s.glow(circle(170, 86, 62), '#9FE6FF', 0.55, 12);
    snowflake(s, 170, 86, 66, 13);
    for (const [x, y, r] of [[64, 152, 9], [112, 214, 8], [210, 168, 7], [96, 64, 6]] as const) {
      s.part(star(x, y, r * 1.6, r * 0.5, 4, -90), M.ice, { sw: 2, gloss: 0 });
    }
  },

  arcane_barrier(s) {
    s.shadow(128, 238, 80, 10, 0.25);
    s.glow(circle(128, 124, 108), '#B070FF', 0.35, 12);
    const bubble = s.uid('bubble');
    s.def(`<radialGradient id="${bubble}" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="#C79CFF" stop-opacity="0.12"/><stop offset="0.88" stop-color="#9A5BF0" stop-opacity="0.5"/><stop offset="1" stop-color="#6A28C8" stop-opacity="0.85"/></radialGradient>`);
    s.add(`<path d="${circle(128, 124, 104)}" fill="url(#${bubble})" stroke="#3A1470" stroke-width="4"/>`);
    // Padrão hexagonal sutil
    let hex = '';
    for (const [x, y] of [[128, 124], [128, 74], [128, 174], [84, 99], [172, 99], [84, 149], [172, 149]] as const) hex += `${poly(ngon(x, y, 28, 6, 0))} `;
    s.clip(circle(128, 124, 100), () => s.stroke(hex, 2.5, '#E8D4FF', 0.45));
    // Escudo interno
    s.part(tf(UNIT.heater, 128, 128, 56, 64), M.gold, { sw: 4.5 });
    s.part(tf(UNIT.heater, 128, 126, 44, 50), M.cloth, { sw: 3, gloss: 0.7 });
    gem(s, 128, 118, 11);
    s.add(`<path d="M52,92 A84,84 0 0 1 110,40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity="0.8"/>`);
    s.sparkle(204, 52, 12);
    s.sparkle(46, 186, 9, '#F0E0FF');
  },

  precise_shot(s) {
    s.shadow(116, 238, 74, 9, 0.25);
    const cx = 112, cy = 140;
    s.part(circle(cx, cy, 90), M.gold, { sw: 4.5 });
    s.part(circle(cx, cy, 78), M.cream, { sw: 3, gloss: 0 });
    s.part(circle(cx, cy, 60), M.red, { sw: 3, gloss: 0 });
    s.part(circle(cx, cy, 42), M.cream, { sw: 3, gloss: 0 });
    s.part(circle(cx, cy, 24), M.red, { sw: 3, gloss: 0 });
    s.fill(circle(cx, cy, 90), `url(#${s.glossId()})`, 0.6);
    // Flecha cravada no centro
    s.stroke(`M${cx - 6},${cy - 2} L${cx + 6},${cy + 2} M${cx - 2},${cy + 8} L${cx + 3},${cy - 8}`, 3, '#4A0610', 0.8);
    s.line(`M${cx},${cy} L214,38`, 9, '#C88A4C', '#3E1E08', 3);
    s.stroke(`M${cx + 6},${cy - 9} L208,36`, 2.5, '#FFE0B0', 0.7);
    for (const k of [0, 1]) {
      const bx = 198 - k * 12, by = 54 + k * 12;
      s.part(`M${bx},${by} L${bx + 30},${by - 34} L${bx + 42},${by - 30} L${bx + 14},${by + 4} Z`, M.gem, { sw: 3, gloss: 0.5 });
      s.part(`M${bx},${by} L${bx + 34},${by - 30} L${bx + 30},${by - 42} L${bx - 4},${by - 14} Z`, M.gem, { sw: 3, gloss: 0.5 });
    }
    s.part(circle(cx, cy, 7), M.steel, { sw: 2.5, gloss: 0 });
  },

  hide(s) {
    s.shadow(128, 238, 80, 9, 0.3);
    s.part(blob(HOOD), M.hood, { sw: 5, gloss: 0.55 });
    // Dobras do manto
    s.stroke('M72,150 Q80,200 70,224 M184,150 Q176,200 186,224 M128,196 L128,232', 4, '#120A24', 0.5);
    s.part(blob(HOOD_FACE), M.dark, { sw: 4, gloss: 0 });
    s.add(`<path d="${blob(scalePts(HOOD_FACE, 128, 130, 0.75, 0, 6))}" fill="#000" opacity="0.35"/>`);
    // Olhos brilhando
    for (const x of [108, 148]) {
      s.glow(ellipse(x, 136, 16, 9), '#FFE070', 0.8, 5);
      s.add(`<path d="M${x - 13},${138} Q${x},${126} ${x + 13},${136} Q${x},${144} ${x - 13},${138} Z" fill="#FFF4B0" stroke="#C88A10" stroke-width="1.5"/>`);
    }
    // Máscara (faixa) sob os olhos
    s.part('M92,150 Q128,162 164,150 L160,176 Q128,190 96,176 Z', M.leatherDark, { sw: 3, gloss: 0.3 });
    gem(s, 128, 206, 11);
    s.sparkle(206, 46, 10, '#D8C8FF', 0.9);
  },

  charge(s) {
    s.shadow(150, 236, 72, 9, 0.28);
    // Linhas de velocidade
    for (const [y, x0, len, w] of [[78, 34, 66, 10], [114, 14, 78, 13], [150, 22, 70, 12], [186, 40, 56, 9]] as const) {
      s.part(new Curve([[x0, y], [x0 + len, y + 2]]).tapered((t) => w * t), M.ice, { sw: 2.5, gloss: 0, angle: 'diag' });
    }
    // Poeira
    for (const [x, y, r] of [[58, 214, 14], [80, 222, 10], [38, 222, 8]] as const) s.part(circle(x, y, r), M.cream, { sw: 2.5, gloss: 0.5 });
    s.group('rotate(-12 152 128)', () => {
      s.part(ellipse(152, 128, 78, 88), M.gold, { sw: 5 });
      s.part(ellipse(152, 128, 64, 74), M.steel, { sw: 3.5 });
      s.stroke(`M152,58 L152,198 M90,128 L214,128`, 9, '#B8741A', 0.9);
      s.stroke(`M152,58 L152,198 M90,128 L214,128`, 4, '#FFE08A', 0.9);
      for (const [x, y] of [[112, 86], [192, 86], [112, 170], [192, 170]] as const) rivet(s, x, y, 6);
      s.part(circle(152, 128, 26), M.gold, { sw: 4 });
      gem(s, 152, 128, 11);
    });
  },

  push(s) {
    s.shadow(110, 236, 70, 8, 0.25);
    // Ondas de choque
    for (const [r, w] of [[62, 12], [84, 10], [106, 8]] as const) {
      const pts: Pt[] = [];
      for (let a = -52; a <= 52; a += 13) pts.push([116 + r * Math.cos((a * Math.PI) / 180), 128 + r * Math.sin((a * Math.PI) / 180)]);
      s.part(new Curve(pts).tapered((t) => w * Math.sin(Math.PI * t) + 1.5), M.ice, { sw: 2.5, gloss: 0 });
    }
    // Manopla
    s.part('M24,96 L72,86 L76,176 L24,166 Z', M.gold, { sw: 4.5 });
    s.stroke('M38,100 L40,162', 4, '#FFF4C0', 0.7);
    s.part(rrect(64, 76, 98, 110, 30), M.steel, { sw: 4.5 });
    for (const [i, y] of [[0, 80], [1, 106], [2, 132]] as const) {
      void i;
      s.part(rrect(126, y, 52, 28, 13), M.steel, { sw: 4, gloss: 0.7 });
    }
    s.part('M84,150 Q86,138 104,138 L160,140 Q176,142 176,158 Q176,176 158,178 L100,182 Q84,182 84,166 Z', M.steel, { sw: 4.5 });
    s.stroke('M98,150 L158,150', 3, '#fff', 0.7);
    rivet(s, 92, 98, 6);
    rivet(s, 92, 122, 6);
  },

  thorns(s) {
    s.shadow(128, 238, 82, 9, 0.25);
    const vines = [
      new Curve([[34, 214], [70, 160], [128, 150], [168, 104], [214, 40]]),
      new Curve([[44, 48], [96, 82], [116, 140], [170, 172], [222, 212]]),
    ];
    const width = (t: number) => 30 - 16 * t;
    vines.forEach((v, vi) => {
      s.part(v.tapered(width), M.bramble, { sw: 4.5, gloss: 0.45 });
      for (let i = 1; i <= 7; i++) {
        const t = i / 8.2;
        const { p, n, t: tg } = v.at(t);
        const sg = (i + vi) % 2 === 0 ? 1 : -1;
        const h = width(t) / 2 - 1.5, L = 28 - 8 * t;
        const b1: Pt = [p[0] + n[0] * h * sg - tg[0] * 10, p[1] + n[1] * h * sg - tg[1] * 10];
        const b2: Pt = [p[0] + n[0] * h * sg + tg[0] * 10, p[1] + n[1] * h * sg + tg[1] * 10];
        const tip: Pt = [p[0] + n[0] * (h + L) * sg + tg[0] * 12, p[1] + n[1] * (h + L) * sg + tg[1] * 12];
        s.part(`M${pt(b1)} Q${pt([(b1[0] + tip[0]) / 2 - tg[0] * 3, (b1[1] + tip[1]) / 2 - tg[1] * 3])} ${pt(tip)} L${pt(b2)} Z`, M.thorn, { sw: 3, gloss: 0 });
      }
    });
    for (const [x, y, rot, sz] of [[86, 112, -60, 22], [176, 140, 30, 20], [206, 64, 40, 16]] as const) {
      s.group(`rotate(${rot} ${x} ${y})`, () => {
        s.part(tf(UNIT.leaf, x, y, sz * 0.9, sz * 1.5), M.leaf, { sw: 3 });
        s.stroke(`M${x},${y - sz * 1.2} L${x},${y + sz * 1.2}`, 2, '#14420C', 0.6);
      });
    }
  },

  natural_heal(s) {
    s.shadow(128, 238, 70, 8, 0.22);
    s.glow(circle(128, 120, 90), '#9CFF6A', 0.4, 14);
    s.group('rotate(-38 108 112)', () => {
      s.part(tf(UNIT.leaf, 108, 112, 78, 100), M.leaf, { sw: 5 });
      s.stroke('M108,24 L108,204', 4, '#E8FFC0', 0.9);
      let veins = '';
      for (const y of [64, 98, 132, 166]) veins += `M108,${y + 14} Q${80},${y} 62,${y - 12} M108,${y + 14} Q136,${y} 154,${y - 12} `;
      s.stroke(veins, 3, '#E8FFC0', 0.7);
      s.line('M108,204 L108,232', 7, '#7A4A1E', '#3E1E08', 2.5);
    });
    s.glow(tf(UNIT.plus, 176, 178, 50), '#CFFF9A', 0.9, 8);
    s.part(tf(UNIT.plus, 176, 178, 42), M.green, { sw: 5 });
    s.part(tf(UNIT.plus, 174, 176, 26), M.white, { sw: 0, gloss: 0.6 });
    s.sparkle(210, 104, 13);
    s.sparkle(126, 224, 9, '#E8FFC0');
    s.sparkle(52, 196, 10, '#E8FFC0');
  },

  root(s) {
    s.shadow(128, 236, 100, 10, 0.3);
    s.part(ellipse(128, 214, 104, 24), M.dirt, { sw: 4.5, gloss: 0.4 });
    const roots: [Pt[], number][] = [
      [[[66, 216], [44, 170], [48, 112], [80, 70], [108, 74], [104, 96]], 28],
      [[[190, 216], [212, 170], [208, 112], [176, 70], [148, 74], [152, 96]], 28],
      [[[108, 216], [96, 170], [104, 122], [124, 84], [118, 52]], 22],
      [[[150, 216], [164, 180], [156, 144], [140, 126]], 16],
    ];
    for (const [ctrl, w] of roots) {
      const c = new Curve(ctrl);
      s.part(c.tapered((t) => w * (1 - t) + 1), M.wood, { sw: 4, gloss: 0.45 });
      // Raizinhas
      const { p, n } = c.at(0.42);
      s.part(new Curve([p, [p[0] + n[0] * 22, p[1] + n[1] * 22 - 6], [p[0] + n[0] * 30, p[1] + n[1] * 30 - 18]]).tapered((t) => 8 * (1 - t) + 0.5), M.wood, { sw: 3, gloss: 0 });
    }
    s.stroke('M60,212 Q90,222 128,220 M150,222 Q180,220 196,210', 3, '#24140A', 0.5);
    for (const [x, y] of [[118, 52], [56, 104]] as const) {
      s.group(`rotate(35 ${x} ${y})`, () => s.part(tf(UNIT.leaf, x + 8, y - 12, 9, 15), M.leaf, { sw: 2.5 }));
    }
  },
};

// ---------------------------------------------------------------------------
// Itens (não-armas)
// ---------------------------------------------------------------------------

const items: Record<string, (s: Icon) => void> = {
  'armor.tunic'(s) {
    s.shadow(128, 238, 76, 9);
    const body = 'M100,38 Q128,64 156,38 L188,50 L226,98 L198,128 L182,114 L194,222 Q128,236 62,222 L74,114 L58,128 L30,98 L68,50 Z';
    s.part(body, M.cloth, { sw: 5 });
    s.stroke('M98,120 Q92,170 86,214 M158,120 Q164,170 170,214', 4, '#1C0E50', 0.4);
    // Gola em V
    s.part('M100,38 Q128,64 156,38 L162,44 L128,104 L94,44 Z', M.gold, { sw: 3.5 });
    s.part('M106,46 Q128,64 150,46 L128,88 Z', M.dark, { sw: 2, gloss: 0 });
    // Punhos e barra
    s.part('M30,98 L42,86 L66,116 L58,128 Z', M.gold, { sw: 3.5 });
    s.part('M226,98 L214,86 L190,116 L198,128 Z', M.gold, { sw: 3.5 });
    s.part('M64,204 Q128,218 192,204 L194,222 Q128,236 62,222 Z', M.gold, { sw: 3.5 });
    // Cinto
    s.part('M76,142 Q128,154 180,142 L182,162 Q128,174 74,162 Z', M.leather, { sw: 3.5, gloss: 0.4 });
    s.part(rrect(114, 142, 28, 26, 6), M.gold, { sw: 3 });
    s.part(rrect(122, 149, 12, 12, 3), M.gem, { sw: 2, gloss: 0 });
    s.sparkle(64, 70, 8, '#E8E0FF', 0.9);
  },

  'armor.leather'(s) {
    s.shadow(128, 238, 76, 9);
    const body = 'M86,42 Q128,70 170,42 L196,62 L202,200 Q128,228 54,200 L60,62 Z';
    s.part(body, M.leather, { sw: 5 });
    s.stroke('M70,70 L66,196 M186,70 L190,196', 2.5, '#FFD8A8', 0.6, '6 6');
    s.stroke('M128,72 L128,218', 4, '#3A1A08', 0.6);
    // Laço central
    s.stroke('M118,84 L138,100 M138,84 L118,100 M118,108 L138,124 M138,108 L118,124', 3, '#F2D9B0', 0.9);
    // Ombreiras
    for (const x of [62, 194]) {
      s.part(ellipse(x, 66, 34, 24), M.leatherDark, { sw: 4.5 });
      s.stroke(`M${x - 24},${70} Q${x},${50} ${x + 24},${70}`, 2.5, '#FFD8A8', 0.55, '5 5');
      rivet(s, x, 62, 5);
    }
    // Tiras
    for (const y of [146, 182]) {
      s.part(`M58,${y} Q128,${y + 14} 200,${y} L200,${y + 18} Q128,${y + 32} 58,${y + 18} Z`, M.leatherDark, { sw: 3.5, gloss: 0.3 });
      s.part(rrect(84, y + 1, 26, 22, 4), M.gold, { sw: 3 });
      s.part(rrect(91, y + 7, 12, 10, 2), M.leatherDark, { sw: 1.5, gloss: 0 });
    }
  },

  'armor.reinforced_mail'(s) {
    s.shadow(128, 238, 78, 9);
    const pat = s.uid('mail');
    s.def(`<pattern id="${pat}" width="12" height="10" patternUnits="userSpaceOnUse"><circle cx="6" cy="5" r="4" fill="none" stroke="#5A6472" stroke-width="2"/><circle cx="0" cy="0" r="4" fill="none" stroke="#5A6472" stroke-width="2"/><circle cx="12" cy="0" r="4" fill="none" stroke="#5A6472" stroke-width="2"/><circle cx="0" cy="10" r="4" fill="none" stroke="#5A6472" stroke-width="2"/><circle cx="12" cy="10" r="4" fill="none" stroke="#5A6472" stroke-width="2"/></pattern>`);
    const skirt = 'M70,118 L186,118 L198,216 Q128,234 58,216 Z';
    s.part(skirt, M.steel, { sw: 4.5, gloss: 0.3 });
    s.fill(skirt, `url(#${pat})`, 0.8);
    s.part('M60,208 Q128,226 196,208 L198,218 Q128,236 58,218 Z', M.gold, { sw: 3 });
    // Peitoral
    const plate = 'M72,46 Q128,72 184,46 L200,68 L192,152 Q128,174 64,152 L56,68 Z';
    s.part(plate, M.steel, { sw: 5 });
    s.stroke('M128,70 L128,164', 3, '#7A8592', 0.8);
    s.stroke('M120,74 L118,158', 3.5, '#fff', 0.7);
    s.line('M72,46 Q128,72 184,46', 7, '#F4B43C', '#6A3A0C', 2.5);
    s.line('M66,150 Q128,172 190,150', 6, '#F4B43C', '#6A3A0C', 2.5);
    gem(s, 128, 104, 10);
    for (const [x, y] of [[80, 80], [176, 80], [84, 132], [172, 132]] as const) rivet(s, x, y, 5);
    // Ombreiras
    for (const [x, rot] of [[56, -18], [200, 18]] as const) {
      s.group(`rotate(${rot} ${x} 66)`, () => {
        s.part(`M${x - 34},78 Q${x - 34},40 ${x},40 Q${x + 34},40 ${x + 34},78 Z`, M.steel, { sw: 4.5 });
        s.line(`M${x - 33},76 L${x + 33},76`, 6, '#F4B43C', '#6A3A0C', 2.5);
        rivet(s, x, 56, 5);
      });
    }
  },

  'accessory.vitality_amulet'(s) {
    s.shadow(128, 238, 56, 8, 0.25);
    chain(s, [[64, 24], [70, 70], [104, 100], [128, 104], [152, 100], [186, 70], [192, 24]], 16);
    s.part(circle(128, 108, 10), M.gold, { sw: 3 });
    s.part(tf(UNIT.heart, 128, 168, 70, 66), M.gold, { sw: 5 });
    s.part(tf(UNIT.heart, 128, 166, 52, 48), M.red, { sw: 3.5, gloss: 0 });
    s.shine(100, 142, 14, 8, -35, 0.85);
    s.shine(150, 192, 5, 3, -35, 0.5);
    for (const [x, y] of [[128, 128], [72, 134], [184, 134]] as const) s.fill(circle(x, y, 3.5), '#FFF6C8', 0.9);
    s.sparkle(196, 132, 12);
  },

  'accessory.ash_medallion'(s) {
    s.shadow(128, 238, 64, 8, 0.25);
    chain(s, [[64, 22], [70, 60], [102, 82], [128, 86], [154, 82], [186, 60], [192, 22]], 15);
    s.part(circle(128, 90, 10), M.gold, { sw: 3 });
    s.part(star(128, 160, 82, 64, 12, -90), M.goldDark, { sw: 4 });
    s.part(circle(128, 160, 64), M.gold, { sw: 4.5 });
    const face = s.uid('ember');
    s.def(`<radialGradient id="${face}" cx="0.5" cy="0.62" r="0.6"><stop offset="0" stop-color="#C8381A"/><stop offset="0.6" stop-color="#5A1208"/><stop offset="1" stop-color="#2A0804"/></radialGradient>`);
    s.add(`<path d="${circle(128, 160, 50)}" fill="url(#${face})" stroke="#4A1A06" stroke-width="3.5"/>`);
    s.glow(circle(128, 172, 30), '#FF7A2A', 0.7, 8);
    flame(s, 128, 160, 30, 38, 3, 3.5);
    for (const [x, y] of [[100, 132], [158, 138], [104, 190]] as const) s.fill(circle(x, y, 2.5), '#FFC060', 0.9);
    s.fill(circle(128, 160, 64), `url(#${s.glossId()})`, 0.5);
  },

  'accessory.frost_medallion'(s) {
    s.shadow(128, 238, 64, 8, 0.25);
    chain(s, [[64, 22], [70, 60], [102, 82], [128, 86], [154, 82], [186, 60], [192, 22]], 15);
    s.part(circle(128, 90, 10), M.gold, { sw: 3 });
    s.part(poly(ngon(128, 160, 78, 6, -90)), M.gold, { sw: 5 });
    s.part(poly(ngon(128, 160, 62, 6, -90)), M.blue, { sw: 3.5, gloss: 0.3 });
    snowflake(s, 128, 160, 50, 9, '#FFFFFF', '#0A2050');
    for (const p of ngon(128, 160, 70, 6, -90)) s.part(circle(p[0], p[1], 5), M.ice, { sw: 2, gloss: 0 });
    s.fill(poly(ngon(128, 160, 78, 6, -90)), `url(#${s.glossId()})`, 0.45);
  },

  'consumable.health_potion'(s) {
    s.shadow(128, 238, 64, 9);
    const body = 'M108,96 L108,62 L148,62 L148,96 C182,106 202,134 202,164 C202,204 168,230 128,230 C88,230 54,204 54,164 C54,134 74,106 108,96 Z';
    const inner = 'M112,100 L112,64 L144,64 L144,100 C176,110 196,136 196,164 C196,200 164,224 128,224 C92,224 60,200 60,164 C60,136 80,110 112,100 Z';
    flask(s, body, 128, M.red, inner);
    for (const [x, y, r] of [[150, 170, 6], [104, 196, 4], [160, 200, 3.5]] as const) s.add(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#fff" stroke-width="2" opacity="0.7"/>`);
    s.add(`<path d="M78,150 Q80,122 104,110" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity="0.8"/>`);
    s.part(rrect(100, 54, 56, 14, 6), M.gold, { sw: 3.5 });
    s.part(rrect(110, 22, 36, 36, 8), M.wood, { sw: 4, gloss: 0.5 });
    s.stroke('M116,34 L140,34 M116,44 L140,44', 2, '#3E1E08', 0.5);
    s.part(tf(UNIT.heart, 128, 170, 16, 15), M.white, { sw: 2.5, gloss: 0, opacity: 0.85 });
  },

  'consumable.focus_potion'(s) {
    s.shadow(128, 238, 56, 9);
    const body = 'M112,90 L112,60 L144,60 L144,90 Q174,96 174,128 L174,206 Q174,230 150,230 L106,230 Q82,230 82,206 L82,128 Q82,96 112,90 Z';
    const inner = 'M116,94 L116,62 L140,62 L140,94 Q168,100 168,128 L168,204 Q168,224 148,224 L108,224 Q88,224 88,204 L88,128 Q88,100 116,94 Z';
    flask(s, body, 120, M.blue, inner);
    s.sparkle(116, 172, 11, '#E8FAFF');
    s.sparkle(148, 200, 7, '#E8FAFF', 0.9);
    s.sparkle(150, 146, 6, '#E8FAFF', 0.8);
    s.add(`<path d="M96,200 L96,132 Q96,112 112,106" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity="0.8"/>`);
    s.part(rrect(104, 52, 48, 13, 6), M.gold, { sw: 3.5 });
    s.part(rrect(113, 22, 30, 34, 8), M.wood, { sw: 4, gloss: 0.5 });
    gem(s, 128, 20, 7, M.blue);
  },

  'consumable.oil_flask'(s) {
    s.shadow(128, 238, 80, 9);
    const body = 'M110,68 L146,68 L146,100 L204,202 Q212,226 186,226 L70,226 Q44,226 52,202 L110,100 Z';
    const inner = 'M114,70 L142,70 L142,102 L198,202 Q204,220 184,220 L72,220 Q52,220 58,202 L114,102 Z';
    flask(s, body, 150, M.amber, inner);
    s.add(`<path d="M76,196 L112,132" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.75"/>`);
    // Gota no rótulo
    s.part(rrect(98, 168, 60, 40, 8), M.cream, { sw: 3, gloss: 0.3 });
    s.part(tf(UNIT.drop, 128, 188, 11, 15), M.amber, { sw: 2.5, gloss: 0.6 });
    // Rolha de pano amarrada
    s.part('M104,66 Q100,40 112,26 Q128,16 144,26 Q156,40 152,66 Z', M.cream, { sw: 4, gloss: 0.4 });
    s.line('M104,62 Q128,70 152,62', 5, '#C88A4C', '#3E1E08', 2);
    s.line('M150,64 Q164,72 160,88', 4, '#C88A4C', '#3E1E08', 2);
  },
};

// ---------------------------------------------------------------------------
// Estados (medalhas redondas)
// ---------------------------------------------------------------------------

function badge(s: Icon, disc: Mat) {
  s.shadow(128, 240, 70, 7, 0.25);
  s.part(circle(128, 128, 112), M.gold, { sw: 5, gloss: 0.5 });
  const id = s.uid('disc');
  s.def(`<radialGradient id="${id}" cx="0.4" cy="0.32" r="0.75"><stop offset="0" stop-color="${disc.stops[0]}"/><stop offset="0.55" stop-color="${disc.stops[1]}"/><stop offset="1" stop-color="${disc.stops[2]}"/></radialGradient>`);
  s.add(`<path d="${circle(128, 128, 96)}" fill="url(#${id})" stroke="${disc.line}" stroke-width="4"/>`);
}
function badgeGloss(s: Icon) {
  s.add(`<path d="M52,108 Q60,48 128,40 Q196,48 204,108 Q128,82 52,108 Z" fill="#fff" opacity="0.28"/>`);
}

const statuses: Record<string, (s: Icon) => void> = {
  burning(s) {
    badge(s, DISC.burning);
    s.glow(circle(128, 150, 50), '#FFD060', 0.6, 10);
    flame(s, 128, 136, 62, 76, 3, 5);
    badgeGloss(s);
  },
  slowed(s) {
    badge(s, DISC.slowed);
    snowflake(s, 128, 128, 74, 15, '#FFFFFF', '#0A2050');
    badgeGloss(s);
  },
  rooted(s) {
    badge(s, DISC.rooted);
    s.clip(circle(128, 128, 94), () => {
      s.part(ellipse(128, 206, 100, 30), M.dirt, { sw: 4, gloss: 0 });
      const roots: [Pt[], number][] = [
        [[[84, 206], [58, 160], [66, 104], [100, 74], [122, 84], [114, 104]], 28],
        [[[172, 206], [198, 160], [190, 104], [156, 74], [134, 84], [142, 104]], 28],
        [[[128, 206], [122, 160], [130, 124], [124, 100]], 18],
      ];
      for (const [ctrl, w] of roots) s.part(new Curve(ctrl).tapered((t) => w * (1 - t) + 1.5), M.wood, { sw: 4.5, gloss: 0.5 });
    });
    badgeGloss(s);
  },
  hidden(s) {
    badge(s, DISC.hidden);
    const eye = 'M50,130 Q128,52 206,130 Q128,204 50,130 Z';
    s.part(eye, M.white, { sw: 6, gloss: 0 });
    s.clip(eye, () => {
      s.part(circle(128, 130, 34), M.gem, { sw: 4, gloss: 0 });
      s.fill(circle(128, 130, 15), '#12061E');
      s.shine(116, 118, 9, 6, -35, 0.95);
    });
    s.line('M62,196 L194,64', 14, '#FFFFFF', '#151824', 6);
    badgeGloss(s);
  },
  barrier(s) {
    badge(s, DISC.barrier);
    s.glow(tf(UNIT.heater, 128, 130, 64, 72), '#E8D4FF', 0.6, 8);
    s.part(tf(UNIT.heater, 128, 130, 58, 66), M.gold, { sw: 5 });
    s.part(tf(UNIT.heater, 128, 128, 44, 50), M.white, { sw: 3.5, gloss: 0.6 });
    gem(s, 128, 120, 12);
    badgeGloss(s);
  },
};

// ---------------------------------------------------------------------------
// Classes (estandartes)
// ---------------------------------------------------------------------------

function banner(s: Icon, field: Mat) {
  s.shadow(128, 240, 66, 7, 0.22);
  const cloth = 'M58,36 L198,36 L198,224 L128,194 L58,224 Z';
  s.part(cloth, M.gold, { sw: 5, gloss: 0.3 });
  s.part('M70,44 L186,44 L186,206 L128,181 L70,206 Z', field, { sw: 3.5, gloss: 0.55, angle: 'down' });
  s.part(rrect(36, 22, 184, 20, 10), M.wood, { sw: 4 });
  s.part(circle(36, 32, 13), M.gold, { sw: 3.5 });
  s.part(circle(220, 32, 13), M.gold, { sw: 3.5 });
}

function staff(s: Icon, x0: number, y0: number, x1: number, y1: number, w = 11) {
  s.line(`M${x0},${y0} L${x1},${y1}`, w, '#B07038', '#3E1E08', 3);
  s.stroke(`M${x0 - 2},${y0 - 2} L${x1 - 2},${y1 - 2}`, 2.5, '#F0C890', 0.7);
}

function dagger(s: Icon, x: number, y: number, rot: number, k = 1) {
  s.group(`translate(${x} ${y}) rotate(${rot}) scale(${k})`, () => {
    s.part('M0,-72 L13,-50 L11,22 L-11,22 L-13,-50 Z', M.steel, { sw: 4 });
    s.stroke('M-4,-54 L-4,16', 3, '#fff', 0.75);
    s.part('M-34,20 Q0,12 34,20 L30,34 Q0,28 -30,34 Z', M.gold, { sw: 3.5 });
    s.part(rrect(-8, 32, 16, 30, 5), M.leather, { sw: 3, gloss: 0.3 });
    s.part(circle(0, 68, 10), M.gold, { sw: 3 });
    s.part(circle(0, 68, 4.5), M.gem, { sw: 1.5, gloss: 0 });
  });
}

const classes: Record<string, (s: Icon) => void> = {
  mage(s) {
    banner(s, DISC.mage);
    staff(s, 74, 196, 170, 70, 10);
    s.glow(circle(176, 62, 24), '#D890FF', 0.8, 6);
    s.part(circle(176, 62, 16), M.gem, { sw: 3.5, gloss: 0.4 });
    s.shine(171, 56, 5, 3);
    // Chapéu
    s.part('M118,54 Q132,48 140,62 L162,150 L84,150 L110,74 Q104,62 96,62 Q104,52 118,54 Z', M.cloth, { sw: 4.5 });
    s.part(ellipse(122, 156, 66, 16), M.cloth, { sw: 4.5, gloss: 0.4 });
    s.part('M88,134 Q124,146 160,134 L162,150 Q124,162 86,150 Z', M.gold, { sw: 3.5 });
    s.part(star(118, 104, 12, 5, 5), M.gold, { sw: 2, gloss: 0 });
    s.part(star(140, 84, 7, 3, 5), M.gold, { sw: 1.5, gloss: 0 });
  },
  rogue(s) {
    banner(s, DISC.rogue);
    dagger(s, 158, 128, 35, 1);
    const hood = scalePts(HOOD, 128, 130, 0.52, -16, -4);
    s.part(blob(hood), M.hood, { sw: 4, gloss: 0.5 });
    s.part(blob(scalePts(HOOD_FACE, 128, 130, 0.52, -16, -4)), M.dark, { sw: 3, gloss: 0 });
    for (const x of [102, 122]) s.add(`<ellipse cx="${x}" cy="124" rx="6" ry="3.5" fill="#FFF0A0" stroke="#C88A10" stroke-width="1"/>`);
  },
  warrior(s) {
    banner(s, DISC.warrior);
    s.group('translate(128 118) scale(0.68) translate(-128 -124)', () => sword(s));
    s.part(circle(128, 156, 36), M.gold, { sw: 4.5 });
    s.part(circle(128, 156, 27), M.steel, { sw: 3 });
    s.part(circle(128, 156, 10), M.gold, { sw: 2.5 });
    s.part(circle(128, 156, 4.5), M.gem, { sw: 1.2, gloss: 0 });
  },
  druid(s) {
    banner(s, DISC.druid);
    staff(s, 90, 196, 150, 62, 11);
    s.part(new Curve([[150, 62], [166, 48], [162, 70]]).tapered((t) => 10 * (1 - t) + 1), M.wood, { sw: 3, gloss: 0 });
    s.glow(circle(150, 58, 20), '#D0FF8A', 0.8, 6);
    s.part(circle(150, 60, 11), M.green, { sw: 3, gloss: 0.6 });
    s.group('rotate(-30 118 128)', () => {
      s.part(tf(UNIT.leaf, 118, 128, 36, 56), M.leaf, { sw: 4.5 });
      s.stroke('M118,80 L118,178', 3.5, '#E8FFC0', 0.85);
      s.stroke('M118,112 Q102,104 96,96 M118,112 Q134,104 140,96 M118,140 Q100,132 92,124 M118,140 Q136,132 144,124', 2.5, '#E8FFC0', 0.7);
    });
    s.group('rotate(40 162 150)', () => s.part(tf(UNIT.leaf, 162, 150, 14, 22), M.leaf, { sw: 3 }));
  },
};

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

const actions: Record<string, (s: Icon) => void> = {
  move(s) {
    s.shadow(150, 230, 80, 8);
    for (const [y, x0, len, w] of [[96, 22, 50, 9], [130, 12, 58, 11], [164, 26, 44, 8]] as const) {
      s.part(new Curve([[x0, y], [x0 + len, y]]).tapered((t) => w * t), M.ice, { sw: 2.5, gloss: 0 });
    }
    s.part('M90,50 L154,50 L156,136 Q166,150 198,158 Q228,166 228,192 L228,204 L84,204 L84,150 Q86,100 90,50 Z', M.leather, { sw: 5 });
    s.part('M80,198 L232,198 L232,212 Q232,220 224,220 L84,220 Q78,220 78,212 Z', M.leatherDark, { sw: 4, gloss: 0.3 });
    s.stroke('M156,150 Q190,160 214,172', 2.5, '#FFD8A8', 0.6, '5 5');
    s.part('M82,34 L162,34 L160,64 L84,64 Z', M.gold, { sw: 4 });
    s.part('M86,118 L156,118 L156,136 L86,136 Z', M.leatherDark, { sw: 3, gloss: 0.3 });
    s.part(rrect(110, 112, 26, 30, 5), M.gold, { sw: 3 });
    s.part(rrect(117, 119, 12, 16, 2), M.leatherDark, { sw: 1.5, gloss: 0 });
    gem(s, 122, 49, 7);
  },

  defend(s) {
    s.shadow(128, 240, 70, 8);
    s.part(tf(UNIT.heater, 128, 126, 96, 106), M.gold, { sw: 5 });
    s.part(tf(UNIT.heater, 128, 124, 78, 86), M.steel, { sw: 3.5 });
    s.stroke('M128,46 L128,206', 10, '#8A4A10', 0.9);
    s.stroke('M128,46 L128,206', 5, '#FFE08A', 1);
    s.stroke('M56,112 L200,112', 10, '#8A4A10', 0.9);
    s.stroke('M56,112 L200,112', 5, '#FFE08A', 1);
    for (const [x, y] of [[72, 56], [184, 56], [76, 160], [180, 160]] as const) rivet(s, x, y, 6);
    s.part(circle(128, 112, 22), M.gold, { sw: 4 });
    gem(s, 128, 112, 10);
  },

  interact(s) {
    s.shadow(126, 238, 60, 8);
    s.sparkle(118, 22, 18, '#FFE88A');
    s.part(rrect(70, 194, 104, 36, 10), M.gold, { sw: 4.5 });
    s.part('M76,134 Q76,116 96,114 L160,114 Q182,116 182,140 L180,182 Q176,204 150,204 L102,204 Q78,204 76,182 Z', M.skin, { sw: 4.5 });
    s.part(rrect(98, 38, 34, 108, 17), M.skin, { sw: 4.5 });
    s.shine(108, 70, 4, 14, 0, 0.6);
    for (const [y, x0, w] of [[108, 130, 50], [132, 132, 50], [156, 132, 46]] as const) s.part(rrect(x0, y, w, 26, 13), M.skin, { sw: 4, gloss: 0.4 });
    s.part('M80,150 Q56,138 50,116 Q48,102 62,100 Q74,100 80,114 L100,150 Z', M.skin, { sw: 4.5 });
    s.stroke('M104,56 Q115,52 126,56', 2.5, '#C27A4C', 0.6);
    gem(s, 122, 212, 7);
  },

  end_turn(s) {
    s.shadow(128, 240, 72, 8);
    const glass = 'M86,46 L170,46 C170,98 140,110 134,128 C140,146 170,158 170,210 L86,210 C86,158 116,146 122,128 C116,110 86,98 86,46 Z';
    s.add(`<path d="${glass}" fill="#E8F4FF" fill-opacity="0.4"/>`);
    s.clip(glass, () => {
      const sand = s.grad(M.amber, 'down');
      s.add(`<path d="M96,76 L160,76 Q150,108 128,122 Q106,108 96,76 Z" fill="url(#${sand})"/>`);
      s.add(`<path d="M128,170 Q96,180 86,210 L170,210 Q160,180 128,170 Z" fill="url(#${sand})"/>`);
      s.add(`<path d="M128,122 L128,176" stroke="#E89A24" stroke-width="4"/>`);
      s.add(`<path d="${glass}" fill="url(#${s.glossId()})" opacity="0.6"/>`);
    });
    s.add(`<path d="${glass}" fill="none" stroke="#3A2440" stroke-width="5" stroke-linejoin="round"/>`);
    s.add(`<path d="M98,60 Q100,90 116,108 M100,198 Q102,176 112,166" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.75"/>`);
    for (const x of [70, 186]) s.part(rrect(x - 7, 36, 14, 184, 6), M.wood, { sw: 3.5, gloss: 0.5 });
    s.part(rrect(52, 22, 152, 24, 10), M.gold, { sw: 4.5 });
    s.part(rrect(52, 210, 152, 24, 10), M.gold, { sw: 4.5 });
    gem(s, 128, 34, 6);
    gem(s, 128, 222, 6);
  },

  attack(s) {
    s.shadow(128, 240, 80, 8);
    s.group('translate(128 128) rotate(-42) scale(0.86) translate(-128 -124)', () => sword(s));
    s.group('translate(128 128) rotate(42) scale(0.86) translate(-128 -124)', () => sword(s));
    s.sparkle(128, 70, 16, '#FFF6C8');
  },

  use_item(s) {
    s.shadow(128, 240, 80, 8);
    s.part('M100,80 Q128,88 156,80 C198,100 224,150 212,190 C202,224 162,232 128,232 C94,232 54,224 44,190 C32,150 58,100 100,80 Z', M.leather, { sw: 5 });
    s.stroke('M70,130 Q60,170 74,206 M186,130 Q196,170 182,206', 3, '#3A1A08', 0.4);
    s.part('M102,82 L82,42 Q104,52 128,44 Q152,52 174,42 L154,82 Z', M.leather, { sw: 4.5 });
    s.stroke('M100,50 L106,76 M128,48 L128,78 M156,50 L150,76', 2.5, '#3A1A08', 0.5);
    s.part(rrect(92, 72, 72, 18, 9), M.gold, { sw: 4 });
    s.line('M150,88 Q170,110 162,134', 4, '#F4B43C', '#6A3A0C', 2);
    s.part(circle(162, 138, 7), M.gold, { sw: 2.5 });
    s.part(circle(128, 160, 30), M.gold, { sw: 4.5 });
    s.part(star(128, 160, 18, 8, 4), M.goldDark, { sw: 2, gloss: 0 });
    gem(s, 128, 160, 6);
  },

  cooldown(s) {
    s.shadow(128, 240, 70, 8);
    // Seta circular (sentido anti-horário)
    const R = 100, pts: Pt[] = [];
    for (let a = -70; a >= -330; a -= 13) pts.push([128 + R * Math.cos((a * Math.PI) / 180), 132 + R * Math.sin((a * Math.PI) / 180)]);
    s.part(new Curve(pts).tapered((t) => 6 + 12 * t), M.ice, { sw: 3.5, gloss: 0, angle: 'diag' });
    const e = pts[pts.length - 1]!;
    // ponta de seta na extremidade (tangente anti-horária)
    const a = (-330 * Math.PI) / 180;
    const tx = Math.sin(a), ty = -Math.cos(a), nx = Math.cos(a), ny = Math.sin(a);
    s.part(poly([[e[0] + tx * 26, e[1] + ty * 26], [e[0] + nx * 22, e[1] + ny * 22], [e[0] - nx * 22, e[1] - ny * 22]]), M.ice, { sw: 3.5, gloss: 0 });
    s.part(circle(128, 132, 74), M.gold, { sw: 5 });
    s.part(circle(128, 132, 60), M.cream, { sw: 3.5, gloss: 0.4 });
    let ticks = '';
    for (let i = 0; i < 12; i++) {
      const b = (i * 30 * Math.PI) / 180, r0 = i % 3 === 0 ? 44 : 50;
      ticks += `M${r1(128 + Math.cos(b) * r0)},${r1(132 + Math.sin(b) * r0)} L${r1(128 + Math.cos(b) * 55)},${r1(132 + Math.sin(b) * 55)} `;
    }
    s.stroke(ticks, 4, '#7A5A2E');
    s.line('M128,132 L128,88', 6, '#4E2A80', '#1C0E50', 1.5);
    s.line('M128,132 L156,148', 6, '#4E2A80', '#1C0E50', 1.5);
    s.part(circle(128, 132, 8), M.gold, { sw: 2.5 });
  },

  dice(s) {
    s.shadow(128, 240, 76, 8);
    const H = ngon(128, 130, 108, 6, -90);
    const T0: Pt = [128, 72], T1: Pt = [184, 168], T2: Pt = [72, 168];
    const [H0, H1, H2, H3, H4, H5] = H as [Pt, Pt, Pt, Pt, Pt, Pt];
    const faces: [Pt[], string][] = [
      [[H5, H0, H1], '#E8B8FF'],
      [[H5, H1, T0], '#C878F0'],
      [[H5, T0, T2], '#A848DC'],
      [[H5, H4, T2], '#8A30C0'],
      [[H1, T0, T1], '#9A3CD0'],
      [[H1, H2, T1], '#6E1EA0'],
      [[T2, T1, H3], '#5A1486'],
      [[H4, T2, H3], '#6A1A98'],
      [[H2, T1, H3], '#4A0E72'],
    ];
    for (const [f, c] of faces) s.add(`<path d="${poly(f)}" fill="${c}" stroke="#F4B43C" stroke-width="4" stroke-linejoin="round"/>`);
    s.part(poly([T0, T1, T2]), mat('d20', '#F8D8FF', '#C068F0', '#8A2CC8', '#F4B43C'), { sw: 4, gloss: 0.7 });
    s.add(`<path d="${poly(H)}" fill="none" stroke="#6A3A0C" stroke-width="6" stroke-linejoin="round"/>`);
    s.add(`<path d="${poly(H)}" fill="none" stroke="#F4B43C" stroke-width="3" stroke-linejoin="round"/>`);
    // "20"
    const two = tf('M-1,-0.55 Q-1,-1 0,-1 Q1,-1 1,-0.45 Q1,0 -1,1 L1,1', 115, 140, 10, 15);
    const zero = ellipse(142, 140, 10, 15);
    s.stroke(`${two} ${zero}`, 11, '#2E0648');
    s.stroke(`${two} ${zero}`, 6, '#FFFFFF');
    s.shine(98, 70, 14, 6, -30, 0.7);
  },
};

// ---------------------------------------------------------------------------

const sets: [string, Record<string, (s: Icon) => void>][] = [
  ['abilities', abilities],
  ['items', items],
  ['statuses', statuses],
  ['classes', classes],
  ['actions', actions],
];

let count = 0;
for (const [dir, defs] of sets) {
  mkdirSync(join(iconsDir, dir), { recursive: true });
  for (const [name, draw] of Object.entries(defs)) {
    const s = new Icon(`${dir}-${name}`);
    draw(s);
    writeFileSync(join(iconsDir, dir, `${name}.svg`), s.toString());
    count++;
  }
}
console.log(`${count} ícone(s) SVG gerado(s) em assets/icons/.`);
