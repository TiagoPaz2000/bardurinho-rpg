/**
 * E2E da Fase 3 pela interface: dois Chrome headless (um por jogador) jogam uma partida
 * inteira no cliente 3D em modo rede, só com entrada real (cliques nos botões do lobby, nas
 * células do canvas, nas cartas da barra, no painel do alvo; Enter para encerrar o turno).
 * `window.__arena` / `window.__net` são só LIDOS (estado projetado, ponto da tela de uma
 * célula, versão/hash) para o roteiro decidir a jogada.
 *
 *   npm run web                (cliente em http://127.0.0.1:5173)
 *   npm run e2e:rede-ui        (sobe um servidor próprio na porta 2569, PGlite em memória)
 *
 * Conferências: cada aba só tem a própria equipe enquanto o inimigo não é visto; recarregar a
 * aba B no meio volta à mesma partida (snapshot, hash confere); no fim, hash de cada aba =
 * projeção oficial; resultado da tela = resultado do servidor; nenhum erro no console.
 * Capturas lado a lado em docs/screenshots/fase-03/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { catalog } from '@bardurinho/content';
import { distance, findPath, listActionsOnTarget, type Coord, type GameState } from '@bardurinho/domain';
import { stateHash } from '@bardurinho/protocol';
// @ts-expect-error — utilitário CDP em JS puro (sem tipos)
import { launch, sleep } from './cdp.mjs';

const PORT = Number(process.env.E2E_PORT ?? 2569);
const SERVER = `http://127.0.0.1:${PORT}`;
const SEED = Number(process.env.E2E_SEED ?? 7);
const OUT = process.env.E2E_OUT ?? 'docs/screenshots/fase-03';
const W = 1200;
const H = 780;
mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------------------
// Servidor próprio
// ---------------------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: 'memory', TURN_SECONDS: '90', GAME_LOG: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog: string[] = [];
server.stdout.on('data', (d: Buffer) => serverLog.push(d.toString()));
server.stderr.on('data', (d: Buffer) => serverLog.push(d.toString()));
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${SERVER}/health`)).ok) break;
  } catch {
    /* subindo */
  }
  if (i > 120) throw new Error('servidor não subiu:\n' + serverLog.join(''));
  await sleep(250);
}
log(`servidor em ${SERVER}`);

// ---------------------------------------------------------------------------
// Driver por aba (entrada real; o estado só é lido)
// ---------------------------------------------------------------------------
type Browser = Awaited<ReturnType<typeof launch>> & {
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

const HELPER = `window.__drv = {
  scr(c) { return __arena.cellToScreen(c); },
  onCanvas(x, y) { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS'; },
  hover() { return __arena.tactical.hoverCell; },
  actions() { return __arena.actionBar.list.map((a, i) => ({ i, key: a.key, kind: a.kind, id: a.id, name: a.name, available: a.available, now: !!a.command })); },
  aim() { const a = __arena.tactical.aiming; return a ? { key: a.key, cells: [...a.cells.values()].map(t => ({ c: t.cell, valid: t.valid })) } : null; },
  rect(sel, text) { const els = [...document.querySelectorAll(sel)].filter(e => !text || e.textContent.includes(text)); const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!e.disabled }; },
  net() { const n = __net; return { team: n.team, matchId: n.matchId, version: n.version, inSync: n.status.inSync, connection: n.status.connection, busy: n.busy, mine: n.canControl(n.state.turn.activeUnitId) }; },
};`;

const same = (a: Coord | null | undefined, c: Coord) => !!a && a.x === c.x && a.y === c.y && (a.floor ?? 0) === (c.floor ?? 0);

function driver(b: Browser, name: string) {
  const ev = <T>(e: string) => b.ev(e) as Promise<T>;
  const state = () => ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
  const net = () => ev<{ team: string; matchId: string; version: number; inSync: boolean; connection: string; busy: boolean; mine: boolean }>('__drv.net()');
  async function waitIdle(timeout = 30000) {
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < timeout) {
      calm = (await ev<boolean>('__arena.match.busy')) ? 0 : calm + 1;
      if (calm >= 3) return;
      await sleep(100);
    }
    throw new Error(`${name}: timeout esperando a animação`);
  }
  const SAFE = { x0: 40, x1: W - 300, y0: 70, y1: H - 170 };
  const safe = (p: { x: number; y: number }) => p.x > SAFE.x0 && p.x < SAFE.x1 && p.y > SAFE.y0 && p.y < SAFE.y1;
  async function ensureVisible(c: Coord) {
    for (let i = 0; i < 6; i++) {
      const p = await ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
      if (safe(p) && (await ev<boolean>(`__drv.onCanvas(${p.x}, ${p.y})`))) return p;
      await b.drag(Math.max(150, Math.min(W - 350, p.x)), Math.max(150, Math.min(H - 200, p.y)), (W - 300) / 2, H / 2 - 40, 'middle');
      await sleep(350);
    }
    return ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
  }
  async function hoverCell(c: Coord) {
    const offs = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [0, -16], [6, 12]];
    for (let turn = 0; turn < 4; turn++) {
      const p = await ensureVisible(c);
      for (const [dx, dy] of offs) {
        await b.move(p.x + dx!, p.y + dy!);
        await sleep(220);
        if (same(await ev<Coord | null>('__drv.hover()'), c)) return { x: p.x + dx!, y: p.y + dy! };
      }
      await b.key('KeyE', 'e', 'e'); // célula encoberta: gira a câmera, como um jogador faria
      await sleep(800);
    }
    throw new Error(`${name}: picking não achou a célula ${JSON.stringify(c)}`);
  }
  async function clickCell(c: Coord) {
    const p = await hoverCell(c);
    await b.click(p.x, p.y);
  }
  async function clickButton(sel: string, text?: string) {
    for (let i = 0; i < 50; i++) {
      const r = await ev<{ x: number; y: number; disabled: boolean } | null>(`__drv.rect(${JSON.stringify(sel)}, ${JSON.stringify(text ?? '')})`);
      if (r && !r.disabled) {
        await b.click(r.x, r.y);
        return;
      }
      await sleep(200);
    }
    throw new Error(`${name}: botão ${sel} "${text}" não apareceu`);
  }
  /** Carta da barra (atalho numérico) + clique na célula do alvo. */
  async function fireAt(kind: string, id: string, target: Coord): Promise<boolean> {
    const list = await ev<Array<{ i: number; kind: string; id: string; available: boolean; now: boolean }>>('__drv.actions()');
    const a = list.find((x) => x.kind === kind && x.id === id);
    if (!a || !a.available || a.i >= 9) return false;
    await b.key(`Digit${a.i + 1}`, String(a.i + 1), String(a.i + 1));
    await sleep(250);
    const aim = await ev<{ cells: Array<{ c: Coord; valid: boolean }> } | null>('__drv.aim()');
    if (!aim?.cells.some((t) => same(t.c, target) && t.valid)) {
      await b.key('Escape');
      await sleep(200);
      return false;
    }
    const v = (await net()).version;
    await clickCell(target);
    await waitFor(async () => (await net()).version > v, 8000);
    await waitIdle();
    return true;
  }
  async function waitFor(cond: () => Promise<boolean>, ms: number) {
    const t0 = Date.now();
    while (!(await cond())) {
      if (Date.now() - t0 > ms) return false;
      await sleep(100);
    }
    return true;
  }
  async function load(url: string) {
    await b.send('Page.navigate', { url });
    await waitFor(async () => (await ev<string | undefined>('document.body.dataset.lobby || document.body.dataset.ready')) !== undefined, 60000);
    await b.ev(HELPER);
  }
  return { b, name, ev, state, net, waitIdle, clickCell, clickButton, fireAt, waitFor, load };
}
type Driver = ReturnType<typeof driver>;

// ---------------------------------------------------------------------------
// Robô (decide em Node com o estado projetado da aba)
// ---------------------------------------------------------------------------
function costTo(s: GameState, from: Coord, goal: Coord): number {
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const n = { x: goal.x + dx, y: goal.y + dy, floor: goal.floor };
      if ((!dx && !dy) || distance(n, goal) > 1) continue;
      if (same(from, n)) return 0;
      const p = findPath(s, catalog, from, n);
      if (p) best = Math.min(best, p.cost);
    }
  return best;
}
const enemyStart: Record<string, Coord> = { A: { x: 8, y: 15, floor: 0 }, B: { x: 7, y: 0, floor: 0 } };
const lastSeen = new Map<string, Coord>();
/** Células do térreo sob as plataformas ficam encobertas com o andar mais alto visualizado. */
const underPlatform = (c: Coord) => c.floor === 0 && ((c.x <= 1 && c.y >= 4 && c.y <= 9) || (c.x >= 14 && c.y >= 6 && c.y <= 11));

async function playTurn(d: Driver): Promise<void> {
  const team = (await d.net()).team;
  for (let step = 0; step < 6; step++) {
    const s = await d.state();
    if (s.status !== 'active' || !(await d.net()).mine) return;
    const me = s.units[s.turn.activeUnitId!]!;
    const enemies = Object.values(s.units).filter((u) => u.team !== team && u.alive);
    // 1) Atacar o inimigo visível.
    let attacked = false;
    for (const e of enemies) {
      lastSeen.set(team, e.pos);
      const opts = listActionsOnTarget(s, catalog, me.id, e.id).filter((x) => x.available && (x.kind === 'attack' || x.kind === 'ability'));
      opts.sort((x, y) => Number(y.kind === 'ability') - Number(x.kind === 'ability'));
      for (const o of opts) {
        if (await d.fireAt(o.kind, o.id, e.pos)) {
          log(`  ${d.name}: ${o.name} em ${e.id}`);
          attacked = true;
          break;
        }
      }
      if (attacked) break;
    }
    if (attacked) continue;
    if (me.mp <= 0) break;
    // 2) Andar até o inimigo; sem caminho, abrir uma porta do muro central.
    let goal = enemies[0]?.pos ?? lastSeen.get(team) ?? enemyStart[team]!;
    if (!enemies.length && lastSeen.has(team) && distance(me.pos, goal) <= 1) {
      lastSeen.delete(team);
      goal = enemyStart[team]!;
    }
    if (costTo(s, me.pos, goal) === Infinity) {
      const door = Object.values(s.objects).filter((o) => o.defId === 'door' && o.state === 'closed').sort((x, y) => distance(x.pos, me.pos) - distance(y.pos, me.pos))[0];
      if (door) {
        const open = listActionsOnTarget(s, catalog, me.id, door.id).find((x) => x.kind === 'interact' && x.available);
        if (open) {
          const v = (await d.net()).version;
          await d.clickCell(door.pos);
          await sleep(300);
          await d.clickButton('.ta-btn.ok', 'Abrir');
          await d.waitFor(async () => (await d.net()).version > v, 8000);
          await d.waitIdle();
          log(`  ${d.name}: abriu ${door.id} pelo painel do alvo`);
          continue;
        }
        goal = door.pos;
      }
    }
    const reach = (await d.ev<Array<Coord & { cost: number }>>('__arena.reachable()')).filter((c) => !underPlatform(c));
    const here = costTo(s, me.pos, goal);
    const best = reach.map((c) => ({ c, d: costTo(s, c, goal) })).sort((x, y) => x.d - y.d || x.c.cost - y.c.cost)[0];
    if (!best || !(best.d < here)) break;
    const v = (await d.net()).version;
    await d.clickCell(best.c);
    if (!(await d.waitFor(async () => (await d.net()).version > v, 8000))) break;
    await d.waitIdle();
  }
  if ((await d.state()).status === 'active' && (await d.net()).mine) {
    const v = (await d.net()).version;
    await d.b.key('Enter', 'Enter', '\r');
    await d.waitFor(async () => (await d.net()).version > v, 8000);
    await d.waitIdle();
  }
}

// ---------------------------------------------------------------------------
// Capturas lado a lado
// ---------------------------------------------------------------------------
async function sideBySide(name: string, a: Driver, b: Driver, labels: [string, string]) {
  const pa = `${OUT}/_${name}-a.png`;
  const pb = `${OUT}/_${name}-b.png`;
  await a.b.shot(pa);
  await b.b.shot(pb);
  const [ia, ib] = await Promise.all([loadImage(pa), loadImage(pb)]);
  const scale = 0.6;
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);
  const canvas = createCanvas(w * 2 + 12, h + 30);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141517';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(ia, 0, 30, w, h);
  ctx.drawImage(ib, w + 12, 30, w, h);
  ctx.fillStyle = '#ffd43b';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(labels[0], 8, 21);
  ctx.fillText(labels[1], w + 20, 21);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${OUT}/${name}.png`, canvas.toBuffer('image/png'));
  rmSync(pa);
  rmSync(pb);
  log('📷', name);
}

// ---------------------------------------------------------------------------
// Roteiro
// ---------------------------------------------------------------------------
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  log(`${ok ? 'ok ' : 'FALHOU'} ${what}`);
};
const stamp = Date.now();
const ba = (await launch({ port: 9351, profile: `${tmpdir()}/bardurinho-rede-a-${stamp}`, width: W, height: H })) as Browser;
const bb = (await launch({ port: 9352, profile: `${tmpdir()}/bardurinho-rede-b-${stamp}`, width: W, height: H })) as Browser;
const A = driver(ba, 'A');
const B = driver(bb, 'B');
let exitCode = 0;
try {
  const url = `http://127.0.0.1:5173/?mode=rede&server=${encodeURIComponent(SERVER)}&seed=${SEED}`;
  await A.load(url);
  await B.load(url);
  await A.clickButton('.hud-lobby .hud-button', 'Jogador A');
  await B.clickButton('.hud-lobby .hud-button', 'Jogador B');
  await A.waitFor(async () => !!(await A.ev('__drv.rect(".hud-lobby .hud-button", "Procurar partida")')), 10000);
  await B.waitFor(async () => !!(await B.ev('__drv.rect(".hud-lobby .hud-button", "Procurar partida")')), 10000);
  await sideBySide('01-lobby', A, B, ['Aba 1 — Jogador A (lobby)', 'Aba 2 — Jogador B (lobby)']);
  await A.clickButton('.hud-lobby .hud-button', 'Procurar partida');
  await A.waitFor(async () => (await A.ev('document.body.dataset.ready')) === '1', 90000);
  await A.ev(HELPER);
  await sleep(800);
  await sideBySide('02-aguardando', A, B, ['Jogador A — sala criada, aguardando adversário', 'Jogador B — ainda no lobby']);
  await B.clickButton('.hud-lobby .hud-button', 'Procurar partida');
  await B.waitFor(async () => (await B.ev('document.body.dataset.ready')) === '1', 90000);
  await B.ev(HELPER);
  for (const d of [A, B]) await d.waitFor(async () => (await d.state()).status === 'active', 15000);
  for (const d of [A, B]) await d.ev('__pace.speed = 3');
  await sleep(1500);
  const na = await A.net();
  const nb = await B.net();
  check(na.matchId === nb.matchId, `as duas abas na mesma partida (${na.matchId})`);
  check(na.team === 'A' && nb.team === 'B', 'equipes A e B');
  const sa0 = await A.state();
  const sb0 = await B.state();
  // Fase 6: ids opacos (unit-a1 / unit-b1) — o id não revela a classe do adversário.
  check(Object.keys(sa0.units).join() === 'unit-a1' && Object.keys(sb0.units).join() === 'unit-b1' && sa0.units['unit-a1']?.classId === 'warrior' && sb0.units['unit-b1']?.classId === 'mage', 'no início cada aba só tem o próprio personagem (o inimigo está fora da visão; ids opacos)');
  check(sa0.rng.seed === 0 && sb0.rng.seed === 0, 'semente dos dados não chega ao navegador');
  await sideBySide('03-inicio', A, B, ['Jogador A — vê só o Guerreiro', 'Jogador B — vê só o Mago']);

  let turns = 0;
  let reloaded = false;
  let bothSeen = false;
  while (turns < 80) {
    const s = await A.state();
    if (s.status !== 'active') break;
    const d = (await A.net()).mine ? A : (await B.net()).mine ? B : null;
    if (!d) {
      await sleep(150);
      continue;
    }
    await playTurn(d);
    turns++;
    const [x, y] = [await A.state(), await B.state()];
    if (!bothSeen && Object.keys(x.units).length === 2 && Object.keys(y.units).length === 2 && x.status === 'active') {
      bothSeen = true;
      await sleep(400);
      await sideBySide('04-contato', A, B, ['Jogador A — inimigo à vista', 'Jogador B — inimigo à vista']);
    }
    if (!reloaded && turns === 4) {
      reloaded = true;
      const before = await B.net();
      log('recarregando a aba B (F5) no meio da partida');
      await B.b.send('Page.reload');
      await B.waitFor(async () => (await B.ev('document.body.dataset.ready')) === '1', 90000);
      await B.ev(HELPER);
      await B.ev('__pace.speed = 3');
      await sleep(1200);
      const after = await B.net();
      const dbg = (await (await fetch(`${SERVER}/debug/matches/${after.matchId}`)).json()) as { version: number; seats: Array<{ team: string; projection: { hash: string } }> };
      check(after.matchId === before.matchId && after.team === 'B', 'recarregar a aba B volta à mesma partida e equipe');
      check(after.version === dbg.version && stateHash(await B.state()) === dbg.seats.find((q) => q.team === 'B')!.projection.hash, 'após recarregar, estado da aba B = projeção oficial (snapshot)');
      await sideBySide('05-recarregou-b', A, B, ['Jogador A — continua', 'Jogador B — após recarregar a página (snapshot do servidor)']);
    }
  }
  await sleep(1500);
  for (const d of [A, B]) await d.waitIdle();
  const n = await A.net();
  const dbg = (await (await fetch(`${SERVER}/debug/matches/${n.matchId}`)).json()) as { official: GameState; seats: Array<{ team: string; projection: { hash: string }; divergences: unknown[] }> };
  check(dbg.official.status === 'finished' && dbg.official.result?.kind === 'victory', `partida terminou com vitória (${JSON.stringify(dbg.official.result)}, ${turns} turnos)`);
  for (const d of [A, B]) {
    const st = await d.state();
    const team = (await d.net()).team;
    const seat = dbg.seats.find((q) => q.team === team)!;
    check(stateHash(st) === seat.projection.hash, `${d.name}: hash final da aba = projeção oficial`);
    check(JSON.stringify(st.result) === JSON.stringify(dbg.official.result), `${d.name}: resultado na tela = resultado do servidor`);
    check(seat.divergences.length === 0, `${d.name}: nenhum ack divergente`);
    check(!!(await d.ev('__drv.rect(".end-box")')), `${d.name}: tela de resultado aberta`);
  }
  await sideBySide('06-resultado', A, B, ['Jogador A — resultado (decidido pelo servidor)', 'Jogador B — resultado (decidido pelo servidor)']);
  // Combat Debug Lab NETWORK com a partida encerrada (fica no banco/memória).
  const lab = (await launch({ port: 9353, profile: `${tmpdir()}/bardurinho-rede-lab-${stamp}`, width: 1600, height: 1000 })) as Browser;
  try {
    await lab.send('Page.navigate', { url: `http://127.0.0.1:5174/network.html?server=${encodeURIComponent(SERVER)}&match=${n.matchId}` });
    await sleep(4000);
    await lab.shot(`${OUT}/07-lab-network.png`);
    log('📷 07-lab-network');
    if (lab.logs.length) log('console do Lab:', lab.logs.join('\n'));
  } finally {
    lab.close();
  }
  const errors = [...ba.logs.map((l: string) => `A ${l}`), ...bb.logs.map((l: string) => `B ${l}`)].filter((l) => !/favicon/.test(l));
  check(errors.length === 0, `nenhum erro/aviso no console das abas${errors.length ? `:\n${errors.join('\n')}` : ''}`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  ba.close();
  bb.close();
  server.kill();
}
if (failures.length || exitCode) {
  console.error(`\nFALHOU (${failures.length}):\n${failures.join('\n')}\n\nlog do servidor:\n${serverLog.join('').split('\n').slice(-25).join('\n')}`);
  process.exit(1);
}
log('E2E rede (interface): OK');
process.exit(0);
