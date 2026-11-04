/**
 * E2E da Fase 5 — critério de aprovação: "um jogador completa todo o ciclo sem intervenção
 * manual do desenvolvedor". Chrome headless dirigido **só pela interface** (cliques, digitação,
 * atalhos, cliques nas células do canvas):
 *
 *   1. cadastro → criação de personagem (nome, classe, cor, acessório, consumíveis)
 *   2. loja (compra com moedas) → equipamento (equipar a cor comprada)
 *   3. partida contra o bot (fácil) até o fim → resultado → recompensas (creditadas pelo servidor)
 *   4. de volta ao lobby: saldo, progresso das missões e histórico; recarregar mantém a sessão
 *   5. dois navegadores: matchmaking (fila) e convite por código de amigo, até o fim e recompensas
 *
 * O roteiro decide a jogada com um `BotBrain` (difícil) lendo o estado projetado da aba
 * (`window.__arena`), mas executa só com entrada real. `window.__*` é apenas lido.
 *
 *   npm run web          (cliente em http://127.0.0.1:5173)
 *   npm run e2e:ciclo    (servidor próprio na porta 2571, PGlite em memória)
 *
 * Capturas em docs/screenshots/fase-05/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import { REWARD_TABLE, catalog, patioDasRuinas } from '@bardurinho/content';
import type { Coord, GameState, GameplayCommand } from '@bardurinho/domain';
import type { HistoryEntryDto, MeResponse, MissionDto } from '@bardurinho/protocol';
// @ts-expect-error — utilitário CDP em JS puro (sem tipos)
import { launch, sleep } from './cdp.mjs';

const PORT = Number(process.env.E2E_PORT ?? 2571);
const SERVER = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:5173/?server=${encodeURIComponent(SERVER)}`;
const OUT = process.env.E2E_OUT ?? 'docs/screenshots/fase-05';
const W = 1280;
const H = 820;
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------------------
// Servidor próprio (bot com pausa curta para o roteiro andar rápido)
// ---------------------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: 'memory', TURN_SECONDS: '90', BOT_DELAY_MS: '250', GAME_LOG: '1' },
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
  if (i > 160) throw new Error('servidor não subiu:\n' + serverLog.join(''));
  await sleep(250);
}
log(`servidor em ${SERVER}`);

type Browser = {
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

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  log(`${ok ? 'ok ' : 'FALHOU'} ${what}`);
};
const shots: string[] = [];

// ---------------------------------------------------------------------------
// Driver de uma aba: telas (DOM) + arena (canvas). Só lê o estado; age por entrada real.
// ---------------------------------------------------------------------------
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

function driver(b: Browser, name: string) {
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
  /** Clica no elemento (seletor + texto opcional), esperando ficar habilitado. */
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
  /** Digita num campo: clique (foco) + texto pelo teclado do navegador. */
  async function type(sel: string, text: string) {
    await click(sel);
    await b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`);
    await b.send('Input.insertText', { text });
    await sleep(80);
  }
  const text = (sel: string) => ev<string | null>(`__ui.text(${JSON.stringify(sel)})`);
  const attr = (sel: string, a: string) => ev<string | null>(`__ui.attr(${JSON.stringify(sel)}, ${JSON.stringify(a)})`);
  const exists = async (sel: string) => (await ev<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
  const token = () => ev<string>('JSON.parse(localStorage.getItem("bardurinho.conta")).token');
  async function api<T>(path: string): Promise<T> {
    const res = await fetch(`${SERVER}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
    return (await res.json()) as T;
  }

  // --- Arena -------------------------------------------------------------------------
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
      await b.key('KeyE', 'e', 'e'); // célula encoberta: gira a câmera, como um jogador faria
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
  /** Executa a decisão do bot do roteiro pela interface; false se não deu (o turno é encerrado). */
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
  /** Joga a vez da equipe da aba (decisão no Node com a visão da aba; execução pela interface). */
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
  /** Joga até o fim, enquanto `others` (outras abas na mesma partida) esperam. */
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
  return { b, name, ev, helper, waitFor, waitFlow, flow, load, click, type, text, attr, exists, api, token, state, net, waitIdle, playToEnd, perform };
}
type Driver = ReturnType<typeof driver>;

async function shot(d: Driver, file: string) {
  await d.b.shot(`${OUT}/${file}.png`);
  shots.push(file);
  log('📷', file);
}

async function sideBySide(name: string, a: Driver, b: Driver, labels: [string, string]) {
  const pa = `${OUT}/_${name}-a.png`;
  const pb = `${OUT}/_${name}-b.png`;
  await a.b.shot(pa);
  await b.b.shot(pb);
  const [ia, ib] = await Promise.all([loadImage(pa), loadImage(pb)]);
  const scale = 0.55;
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
  writeFileSync(`${OUT}/${name}.png`, canvas.toBuffer('image/png'));
  rmSync(pa);
  rmSync(pb);
  shots.push(name);
  log('📷', name);
}

/** Cadastro + personagem pela interface. */
async function registerAndCreate(d: Driver, username: string, charName: string, classId: string, opts: { shots?: boolean } = {}) {
  await d.load(WEB);
  await d.waitFlow('login');
  if (opts.shots) await shot(d, '01-login');
  await d.click('[data-login-tab="register"]');
  await d.type('input[name="username"]', username);
  await d.type('input[name="displayName"]', charName.split(' ')[0]!);
  await d.type('input[name="password"]', 'senha-segura-1');
  await d.click('[data-act="register"]');
  await d.waitFlow('character');
  await d.type('input[name="charName"]', charName);
  await d.click(`[data-class="${classId}"]`);
  await d.click('[data-draft-slot="color"][data-value="color.ruby"]');
  await d.click('[data-draft-acc="accessory.vitality_amulet"]');
  if (opts.shots) {
    await d.b.ev('window.__flow && window.__flow.preview && window.__flow.preview.loaded', true).catch(() => undefined);
    await sleep(1500);
    await shot(d, '02-criar-personagem');
  }
  await d.click('[data-act="create-char"]');
  await d.waitFlow('lobby');
}

const stamp = Date.now();
const browsers: Browser[] = [];
let exitCode = 0;
try {
  // =========================================================================
  // 1–4. Um jogador: cadastro → personagem → loja → equipamento → bot → recompensas
  // =========================================================================
  const ba = (await launch({ port: 9371, profile: `${tmpdir()}/bardurinho-ciclo-a-${stamp}`, width: W, height: H })) as Browser;
  browsers.push(ba);
  const A = driver(ba, 'A');
  const userA = `heroi${stamp.toString(36).slice(-5)}`;
  await registerAndCreate(A, userA, 'Lyra Brasa', 'mage', { shots: true });
  let me = await A.api<MeResponse>('/me');
  check(me.characters.length === 1 && me.characters[0]!.name === 'Lyra Brasa' && me.characters[0]!.classId === 'mage', 'cadastro + personagem criados pela interface (Mago "Lyra Brasa")');
  check(me.characters[0]!.appearance.color === 'color.ruby' && me.characters[0]!.accessoryId === 'accessory.vitality_amulet', 'aparência (Rubi) e acessório gravados no servidor');
  const coins0 = me.account.coins;
  check(coins0 === 100 && (await A.attr('[data-coins]', 'data-coins')) === '100', 'moedas de boas-vindas (100) no lobby');
  await shot(A, '03-lobby');

  // Loja
  await A.click('[data-tab="shop"]');
  await A.waitFor(async () => A.exists('[data-buy="color.gold"]'), 10000, 'loja');
  await A.click('[data-buy="color.gold"]');
  await A.waitFor(async () => (await A.attr('[data-coins]', 'data-coins')) === '50', 10000, 'saldo após a compra');
  check((await A.exists('[data-product="color.gold"].owned')), 'loja: "Ouro velho" comprado (50 moedas) e marcado como possuído');
  await shot(A, '04-loja');
  me = await A.api<MeResponse>('/me');
  check(me.account.coins === 50 && me.inventory.includes('color.gold'), 'servidor: saldo 50 e item no inventário');

  // Equipamento
  await A.click('[data-tab="equip"]');
  await A.click('[data-equip-slot="color"][data-value="color.gold"]');
  await A.click('[data-act="save-equip"]');
  await A.waitFor(async () => ((await A.text('[data-act="save-equip"]')) ?? '').includes('salvo'), 10000, 'salvar equipamento');
  me = await A.api<MeResponse>('/me');
  check(me.characters[0]!.appearance.color === 'color.gold', 'equipamento: cor comprada equipada (servidor)');
  await sleep(1200);
  await shot(A, '05-equipamento');

  // Missões antes
  await A.click('[data-tab="missions"]');
  await A.waitFor(async () => A.exists('[data-mission="mission.complete_three"]'), 10000, 'missões');
  check((await A.attr('[data-mission="mission.complete_three"]', 'data-progress')) === '0', 'missões: "Concluir três partidas" em 0/3 antes de jogar');

  // Partida contra o bot
  await A.click('[data-tab="play"]');
  await A.click('[data-difficulty="easy"]');
  await A.click('[data-act="play-bot"]');
  await A.waitFor(async () => (await A.ev<string>('document.body.dataset.ready ?? ""')) === '1', 90000, 'arena carregada');
  await A.helper();
  await A.waitFor(async () => (await A.state()).status === 'active', 20000, 'início da partida');
  await A.ev('__pace.speed = 3');
  const s0 = await A.state();
  const teamA = (await A.net()).team;
  const mine0 = Object.values(s0.units).find((u) => u.team === teamA)!;
  check(mine0.classId === 'mage' && mine0.name === 'Lyra Brasa' && mine0.maxHp === 88, 'na arena: o personagem da conta (Mago, nome, +8 PV do amuleto)');
  check(Object.values(s0.units).every((u) => u.team === mine0.team), 'o bot começa fora da visão (nada vaza)');
  await sleep(1200);
  await shot(A, '06-partida-bot');
  const turns = await A.playToEnd();
  await sleep(1500);
  await A.waitIdle();
  const sEnd = await A.state();
  const n = await A.net();
  check(sEnd.status === 'finished', `partida contra o bot terminou (${JSON.stringify(sEnd.result)}, ${turns} turnos do jogador)`);
  const outcome = sEnd.result?.kind === 'victory' ? (sEnd.result.winnerTeam === n.team ? 'victory' : 'defeat') : 'draw';
  await A.waitFor(async () => A.exists('.end-box [data-end-action="rewards"]'), 15000, 'tela de resultado');
  await shot(A, '07-resultado');
  await A.click('.end-box [data-end-action="rewards"]');
  await A.waitFor(async () => A.exists('[data-reward-coins]'), 15000, 'tela de recompensas');
  const rewardCoins = Number(await A.attr('[data-reward-coins]', 'data-reward-coins'));
  const balance = Number(await A.attr('[data-balance]', 'data-balance'));
  check(rewardCoins === REWARD_TABLE.bot[outcome], `recompensa pela tabela: ${OUTCOME_LABEL(outcome)} contra bot = ${rewardCoins} moedas`);
  check((await A.exists('[data-reward-mission="mission.complete_three"][data-after="1"]')), 'recompensas: "Concluir três partidas" 0 → 1');
  check((await A.exists('[data-reward-mission="daily.play_one"]')), 'recompensas: missão diária "Partida do dia" concluída');
  await sleep(500);
  await shot(A, '08-recompensas');
  me = await A.api<MeResponse>('/me');
  check(me.account.coins === balance && balance >= 50 + rewardCoins + 20, `saldo creditado pelo servidor: ${balance} (50 + ${rewardCoins} + missões)`);

  // De volta ao lobby
  await A.click('[data-act="back-lobby"]');
  await A.waitFlow('lobby', 30000);
  check((await A.attr('[data-coins]', 'data-coins')) === String(balance), 'de volta ao lobby com o saldo novo');
  await A.click('[data-tab="missions"]');
  await A.waitFor(async () => (await A.attr('[data-mission="mission.complete_three"]', 'data-progress')) === '1', 10000, 'progresso de missão');
  const missions = await A.api<MissionDto[]>('/missions');
  check(missions.find((m) => m.id === 'daily.play_one')?.completed === true, 'missões: progresso salvo (diária concluída, permanente 1/3)');
  await shot(A, '09-missoes');
  await A.click('[data-tab="history"]');
  await A.waitFor(async () => A.exists(`[data-history="${n.matchId}"]`), 10000, 'histórico');
  const hist = await A.api<HistoryEntryDto[]>('/matches/history');
  check(hist[0]?.matchId === n.matchId && hist[0]?.mode === 'bot' && hist[0]?.coins === rewardCoins, 'histórico: a partida contra o bot com resultado e moedas');
  await shot(A, '10-historico');
  // Recarregar mantém a sessão (progresso salvo no servidor).
  await A.load(WEB);
  await A.waitFlow('lobby');
  check((await A.attr('[data-coins]', 'data-coins')) === String(balance), 'recarregar a página: continua logado, mesmo saldo');

  // =========================================================================
  // 5. Dois navegadores: matchmaking e convite
  // =========================================================================
  log('== matchmaking (dois navegadores)');
  const bb = (await launch({ port: 9372, profile: `${tmpdir()}/bardurinho-ciclo-b-${stamp}`, width: W, height: H })) as Browser;
  const bc = (await launch({ port: 9373, profile: `${tmpdir()}/bardurinho-ciclo-c-${stamp}`, width: W, height: H })) as Browser;
  browsers.push(bb, bc);
  const B = driver(bb, 'B');
  const C = driver(bc, 'C');
  const userB = `rival${stamp.toString(36).slice(-5)}`;
  const userC = `amiga${stamp.toString(36).slice(-5)}`;
  await registerAndCreate(B, userB, 'Torvo', 'warrior');
  await registerAndCreate(C, userC, 'Sylva', 'druid');
  await B.click('[data-act="queue"]');
  await B.waitFor(async () => B.exists('[data-queue]'), 8000, 'B na fila');
  await sideBySide('11-fila', B, C, ['B — procurando adversário', 'C — no lobby']);
  await C.click('[data-act="queue"]');
  for (const d of [B, C]) {
    await d.waitFor(async () => (await d.ev<string>('document.body.dataset.ready ?? ""')) === '1', 90000, 'arena (fila)');
    await d.helper();
    await d.waitFor(async () => (await d.state()).status === 'active', 20000, 'início PvP');
  }
  const nb = await B.net();
  const nc = await C.net();
  check(nb.matchId === nc.matchId && nb.team !== nc.team, `matchmaking: B e C na mesma partida PvP (${nb.matchId.slice(0, 8)})`);
  await sleep(1200);
  await sideBySide('12-pvp-inicio', B, C, ['B — partida da fila', 'C — partida da fila']);
  // C desiste pela interface (dois cliques: "desistir" e confirmar) para encerrar rápido.
  // Se a vez é de B, B encerra o turno (Enter) para C poder desistir.
  await C.waitFor(async () => {
    if ((await B.net()).mine && !(await B.net()).busy) await B.b.key('Enter', 'Enter', String.fromCharCode(13));
    return (await C.net()).mine && !(await C.net()).busy;
  }, 60000, 'vez de C');
  await C.click('.hud-net [data-act="surrender"]');
  await C.click('.hud-net [data-act="surrender"]', 'confirmar');
  for (const d of [B, C]) await d.waitFor(async () => (await d.state()).status === 'finished', 20000, 'fim PvP');
  for (const d of [B, C]) {
    await d.waitFor(async () => d.exists('.end-box [data-end-action="rewards"]'), 15000, 'resultado PvP');
    await d.click('.end-box [data-end-action="rewards"]');
    await d.waitFor(async () => d.exists('[data-reward-coins]'), 15000, 'recompensa PvP');
  }
  check(Number(await B.attr('[data-reward-coins]', 'data-reward-coins')) === 30 && (await B.attr('[data-outcome]', 'data-outcome')) === 'victory', 'PvP: B venceu (desistência de C) e recebeu 30 moedas');
  check(Number(await C.attr('[data-reward-coins]', 'data-reward-coins')) === 0 && (await C.attr('[data-outcome]', 'data-outcome')) === 'defeat', 'PvP: quem desiste não recebe moedas');
  await sideBySide('13-pvp-recompensas', B, C, ['B — vitória por desistência (+30)', 'C — desistiu (+0)']);
  for (const d of [B, C]) {
    await d.click('[data-act="back-lobby"]');
    await d.waitFlow('lobby');
  }
  const hb = await B.api<HistoryEntryDto[]>('/matches/history');
  check(hb[0]?.mode === 'pvp' && hb[0]?.opponent?.username === userC, 'histórico de B: partida online contra C');

  log('== convite por código de amigo');
  const codeC = (await C.text('[data-friend-code]')) ?? '';
  await B.type('input[name="inviteTo"]', codeC);
  await B.click('[data-act="invite"]');
  await C.waitFor(async () => C.exists('[data-accept]'), 10000, 'convite chegar em C');
  await sideBySide('14-convite', B, C, ['B — convidou C pelo código de amigo', 'C — convite recebido']);
  await C.click('[data-accept]');
  for (const d of [B, C]) {
    await d.waitFor(async () => (await d.ev<string>('document.body.dataset.ready ?? ""')) === '1', 90000, 'arena (convite)');
    await d.helper();
    await d.waitFor(async () => (await d.state()).status === 'active', 20000, 'início do convite');
  }
  check((await B.net()).matchId === (await C.net()).matchId, 'convite aceito: B e C na mesma partida privada');
  await B.waitFor(async () => {
    if ((await C.net()).mine && !(await C.net()).busy) await C.b.key('Enter', 'Enter', String.fromCharCode(13));
    return (await B.net()).mine && !(await B.net()).busy;
  }, 60000, 'vez de B');
  await B.click('.hud-net [data-act="surrender"]');
  await B.click('.hud-net [data-act="surrender"]', 'confirmar');
  for (const d of [B, C]) await d.waitFor(async () => (await d.state()).status === 'finished', 20000, 'fim do convite');
  const hc = await C.api<HistoryEntryDto[]>('/matches/history');
  await C.waitFor(async () => (await C.api<HistoryEntryDto[]>('/matches/history'))[0]?.mode === 'private', 10000, 'histórico do convite');
  check(hc.length >= 1, 'histórico de C atualizado (partida por convite)');

  const errors = browsers.flatMap((x, i) => x.logs.map((l) => `${'ABC'[i]} ${l}`)).filter((l) => !/favicon|Room connection was closed|WebSocket is closed/.test(l));
  check(errors.length === 0, `nenhum erro/aviso no console das abas${errors.length ? `:\n${errors.slice(0, 10).join('\n')}` : ''}`);
} catch (err) {
  console.error(err);
  exitCode = 1;
  for (const [i, x] of browsers.entries()) await x.shot(`${OUT}/erro-${'abc'[i]}.png`).catch(() => undefined);
} finally {
  for (const x of browsers) x.close();
  server.kill();
}

function OUTCOME_LABEL(o: string) {
  return o === 'victory' ? 'vitória' : o === 'defeat' ? 'derrota' : 'empate';
}

log(`capturas (${shots.length}) em ${OUT}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failures.length || exitCode) {
  console.error(`\nFALHOU (${failures.length}):\n${failures.join('\n')}\n\nlog do servidor:\n${serverLog.join('').split('\n').slice(-30).join('\n')}`);
  process.exit(1);
}
log('E2E ciclo completo: OK');
process.exit(0);
