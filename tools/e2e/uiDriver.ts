/**
 * Fase 7: driver de uma aba do Chrome headless para os e2e do ciclo de jogo (mesma estratégia
 * de `ciclo.ts`): telas em DOM + arena no canvas, **só entrada real** (cliques, teclado, cliques
 * nas células); o estado projetado da aba (`window.__arena`, `window.__net`) só é lido para o
 * roteiro decidir a jogada com um `BotBrain`.
 */
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import type { Coord, GameState, GameplayCommand } from '@bardurinho/domain';

export type Browser = {
  ev<T = unknown>(expr: string, awaitPromise?: boolean): Promise<T>;
  logs: string[];
  shot(path: string): Promise<void>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number, button?: string): Promise<void>;
  drag(x0: number, y0: number, x1: number, y1: number, button?: string): Promise<void>;
  key(code: string, key?: string, text?: string): Promise<void>;
  send(method: string, params?: unknown): Promise<unknown>;
  close(): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HELPER = `window.__drv = {
  scr(c) { return __arena.cellToScreen(c); },
  onCanvas(x, y) { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS'; },
  hover() { return __arena.tactical.hoverCell; },
  actions() { return __arena.actionBar.list.map((a, i) => ({ i, key: a.key, kind: a.kind, id: a.id, available: a.available, now: !!a.command })); },
  aim() { const a = __arena.tactical.aiming; return a ? { key: a.key, cells: [...a.cells.values()].map(t => ({ c: t.cell, valid: t.valid })) } : null; },
  net() { const n = __net; return { team: n.team, matchId: n.matchId, version: n.version, busy: n.busy, mine: n.canControl(n.state.turn.activeUnitId), status: n.state.status }; },
};
window.__ui = {
  rect(sel, text) { const els = [...document.querySelectorAll(sel)].filter(e => !text || e.textContent.includes(text)); const e = els[0]; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!e.disabled }; },
  text(sel) { const e = document.querySelector(sel); return e ? e.textContent : null; },
  attr(sel, a) { const e = document.querySelector(sel); return e ? e.getAttribute(a) : null; },
};`;

const same = (a: Coord | null | undefined, c: Coord) => !!a && a.x === c.x && a.y === c.y && (a.floor ?? 0) === (c.floor ?? 0);
const underPlatform = (c: Coord) => c.floor === 0 && ((c.x <= 1 && c.y >= 4 && c.y <= 9) || (c.x >= 14 && c.y >= 6 && c.y <= 11));

export function driver(b: Browser, name: string, o: { serverUrl: string; width: number; height: number; log?: (...a: unknown[]) => void }) {
  const W = o.width;
  const H = o.height;
  const log = o.log ?? (() => undefined);
  const ev = <T>(e: string) => b.ev(e) as Promise<T>;
  const helper = () => b.ev(HELPER);
  async function waitFor(cond: () => Promise<boolean>, ms: number, what?: string) {
    const start = Date.now();
    while (!(await cond().catch(() => false))) {
      if (Date.now() - start > ms) {
        if (what) throw new Error(`${name}: timeout esperando ${what}`);
        return false;
      }
      await sleep(120);
    }
    return true;
  }
  const flow = () => ev<string | undefined>('document.body.dataset.flow');
  async function waitFlow(screen: string, ms = 30000) {
    await waitFor(async () => (await flow()) === screen, ms, `tela ${screen}`);
    await helper();
  }
  async function load(url: string) {
    await b.send('Page.navigate', { url });
    await waitFor(async () => !!(await ev<string | undefined>('document.body.dataset.flow')) && (await ev<string>('document.body.dataset.flow')) !== 'loading', 60000, 'carregar a página');
    await helper();
  }
  async function click(sel: string, text = '', ms = 15000) {
    const start = Date.now();
    for (;;) {
      await helper();
      const r = await ev<{ x: number; y: number; disabled: boolean } | null>(`__ui.rect(${JSON.stringify(sel)}, ${JSON.stringify(text)})`);
      if (r && !r.disabled) {
        await b.click(r.x, r.y);
        await sleep(200);
        return;
      }
      if (Date.now() - start > ms) throw new Error(`${name}: não achou ${sel} "${text}"${r?.disabled ? ' (desabilitado)' : ''}`);
      await sleep(150);
    }
  }
  async function type(sel: string, text: string) {
    await click(sel);
    await b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`);
    await b.send('Input.insertText', { text });
    await sleep(80);
  }
  const text = (sel: string) => ev<string | null>(`__ui.text(${JSON.stringify(sel)})`);
  const attr = (sel: string, a: string) => ev<string | null>(`__ui.attr(${JSON.stringify(sel)}, ${JSON.stringify(a)})`);
  const exists = async (sel: string) => (await ev<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;

  const state = () => ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
  const net = () => ev<{ team: string; matchId: string; version: number; busy: boolean; mine: boolean; status: string }>('__drv.net()');
  async function waitIdle(timeout = 30000) {
    const start = Date.now();
    let calm = 0;
    while (Date.now() - start < timeout) {
      calm = (await ev<boolean>('__arena.match.busy')) ? 0 : calm + 1;
      if (calm >= 3) return;
      await sleep(100);
    }
    throw new Error(`${name}: timeout esperando a animação`);
  }
  const SAFE = { x0: 40, x1: W - 300, y0: 70, y1: H - 190 };
  const safe = (p: { x: number; y: number }) => p.x > SAFE.x0 && p.x < SAFE.x1 && p.y > SAFE.y0 && p.y < SAFE.y1;
  async function ensureVisible(c: Coord) {
    for (let i = 0; i < 6; i++) {
      const p = await ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
      if (safe(p) && (await ev<boolean>(`__drv.onCanvas(${p.x}, ${p.y})`))) return p;
      await b.drag(Math.max(150, Math.min(W - 350, p.x)), Math.max(150, Math.min(H - 220, p.y)), (W - 300) / 2, H / 2 - 40, 'middle');
      await sleep(350);
    }
    return ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
  }
  async function hoverCell(c: Coord) {
    const offs = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [0, -16], [6, 12]];
    for (let turn = 0; turn < 3; turn++) {
      const p = await ensureVisible(c);
      for (const [dx, dy] of offs) {
        await b.move(p.x + dx!, p.y + dy!);
        await sleep(200);
        if (same(await ev<Coord | null>('__drv.hover()'), c)) return { x: p.x + dx!, y: p.y + dy! };
      }
      await b.key('KeyE', 'e', 'e');
      await sleep(800);
    }
    return null;
  }
  async function clickCell(c: Coord): Promise<boolean> {
    const p = await hoverCell(c);
    if (!p) return false;
    await b.click(p.x, p.y);
    return true;
  }
  async function afterCommand(v: number) {
    const ok = await waitFor(async () => (await net()).version > v, 8000);
    await waitIdle();
    return ok;
  }
  async function perform(cmd: GameplayCommand): Promise<boolean> {
    const v = (await net()).version;
    const list = await ev<Array<{ i: number; kind: string; id: string; available: boolean; now: boolean }>>('__drv.actions()');
    const hotkey = async (i: number) => b.key(`Digit${i + 1}`, String(i + 1), String(i + 1));
    switch (cmd.type) {
      case 'END_TURN':
        await b.key('Enter', 'Enter', '\r');
        return afterCommand(v);
      case 'MOVE': {
        if (underPlatform(cmd.to)) return false;
        const sel = list.find((a) => a.kind === 'move');
        if (sel) await hotkey(sel.i);
        await sleep(150);
        if (!(await clickCell(cmd.to))) return false;
        return afterCommand(v);
      }
      case 'DEFEND': {
        const a = list.find((x) => x.kind === 'defend' && x.available);
        if (!a || a.i >= 9) return false;
        await hotkey(a.i);
        return afterCommand(v);
      }
      case 'BASIC_ATTACK':
      case 'USE_ABILITY':
      case 'USE_ITEM': {
        const kind = cmd.type === 'BASIC_ATTACK' ? 'attack' : cmd.type === 'USE_ABILITY' ? 'ability' : 'item';
        const id = cmd.type === 'BASIC_ATTACK' ? cmd.weaponId : cmd.type === 'USE_ABILITY' ? cmd.abilityId : cmd.itemId;
        const a = list.find((x) => x.kind === kind && x.id === id && x.available);
        if (!a || a.i >= 9) return false;
        await hotkey(a.i);
        await sleep(250);
        if (a.now) return afterCommand(v);
        const t = cmd.target;
        if (!t || t.kind !== 'cell') {
          await b.key('Escape');
          return false;
        }
        const target = { x: t.x, y: t.y, floor: t.floor };
        const aim = await ev<{ cells: Array<{ c: Coord; valid: boolean }> } | null>('__drv.aim()');
        if (!aim?.cells.some((x) => same(x.c, target) && x.valid) || underPlatform(target)) {
          await b.key('Escape');
          await sleep(150);
          return false;
        }
        if (!(await clickCell(target))) {
          await b.key('Escape');
          return false;
        }
        return afterCommand(v);
      }
      case 'INTERACT': {
        const s = await state();
        const obj = s.objects[cmd.objectId];
        if (!obj || underPlatform(obj.pos)) return false;
        if (!(await clickCell(obj.pos))) return false;
        await sleep(300);
        const r = await ev<{ x: number; y: number; disabled: boolean } | null>('__ui.rect(".hud-target-actions .ta-btn.ok", "")');
        if (!r || r.disabled) {
          await b.click(10, 10, 'right');
          return false;
        }
        await b.click(r.x, r.y);
        return afterCommand(v);
      }
      default:
        return false;
    }
  }
  async function playTurn(brain: BotBrain) {
    for (let step = 0; step < 10; step++) {
      const s = await state();
      if (s.status !== 'active' || !(await net()).mine) return;
      const d = brain.decide(s);
      const ok = await perform(d.command).catch((err: unknown) => {
        log(`  ${name}: falha na interface (${String(err)})`);
        return false;
      });
      if (d.command.type === 'END_TURN') return;
      if (!ok) {
        brain.rejectedCommand(d.command);
        if (step >= 6) break;
      } else log(`  ${name}: ${d.label}`);
    }
    if ((await state()).status === 'active' && (await net()).mine) {
      const v = (await net()).version;
      await b.key('Enter', 'Enter', '\r');
      await afterCommand(v);
    }
  }
  async function playToEnd(maxTurns = 120) {
    const team = (await net()).team;
    const brain = new BotBrain(catalog, team, { difficulty: 'hard', seed: 42, explore: exploreTargets(patioDasRuinas, team) });
    let turns = 0;
    while (turns < maxTurns) {
      const s = await state();
      if (s.status === 'finished') break;
      if (s.status === 'active' && (await net()).mine && !(await net()).busy) {
        await playTurn(brain);
        turns++;
      } else await sleep(200);
    }
    return turns;
  }
  async function admin<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${o.serverUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await res.json()) as T;
  }
  return { b, name, ev, helper, waitFor, waitFlow, flow, load, click, type, text, attr, exists, state, net, waitIdle, playToEnd, perform, admin };
}
export type Driver = ReturnType<typeof driver>;
