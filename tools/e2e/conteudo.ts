/**
 * E2E de conteúdo da Fase 4 — critério de aprovação: todo o conteúdo do MVP com comportamento
 * verificável no Combat Debug Lab e no cliente 3D.
 *
 *   npm run web  (5173)   npm run lab  (5174)
 *   npm run e2e:conteudo  [pasta-saida=docs/screenshots/fase-04]
 *
 * 1. Lab: todos os cenários de tests/scenarios conferidos no navegador (`__lab.runAll()`), e
 *    alguns abertos pela URL (`?scenario=`) com captura.
 * 2. Cliente 3D, tela de escolha: 2 × 2 com as quatro classes, acessório e consumíveis
 *    escolhidos por cliques; a partida começa com eles.
 * 3. Cliente 3D, casos de `conteudo-casos.ts`: cada jogada é feita por entrada real (atalho
 *    ou clique na carta, clique na célula do canvas, clique no objeto + botão do painel). Antes
 *    de cada jogada o roteiro aplica o mesmo comando no core (dados em média fixa) e, depois
 *    da animação, confere que o estado do cliente é idêntico (hash) ao do core.
 * 4. Rede: servidor próprio (porta 2570), dois Chrome escolhem 2 × 2 no lobby com as quatro
 *    classes e a partida começa com elas (cada aba só com a própria equipe).
 * No fim: cobertura (10 habilidades, 14 itens, 5 estados, 3 superfícies, reações, objetos,
 * área escura, recargas, ícones, VFX/SFX) e nenhum erro/aviso no console. Sai ≠ 0 se faltar algo.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { catalog } from '@bardurinho/content';
import { applyCommand, listActionsOnTarget, type Coord, type GameEvent, type GameState } from '@bardurinho/domain';
import { stateHash } from '@bardurinho/protocol';
// @ts-expect-error — utilitário CDP em JS puro (sem tipos)
import { launch, sleep } from './cdp.mjs';
import { CASES, caseState, caseUrl, stepCommand, type ContentCase, type Step } from './conteudo-casos.js';

const OUT = process.argv[2] ?? 'docs/screenshots/fase-04';
const WEB = 'http://127.0.0.1:5173/';
const LAB = 'http://127.0.0.1:5174/';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  log(`${ok ? 'ok ' : 'FALHOU'} ${what}`);
};

type Browser = {
  ev<T = unknown>(expr: string, awaitPromise?: boolean): Promise<T>;
  send(method: string, params?: unknown): Promise<unknown>;
  shot(path: string): Promise<void>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number, button?: string): Promise<void>;
  drag(x0: number, y0: number, x1: number, y1: number, button?: string, steps?: number): Promise<void>;
  key(code: string, key?: string, text?: string): Promise<void>;
  logs: string[];
  close(): void;
};

const HELPER = `window.__drv = {
  actions() { return __arena.actionBar.list.map((a, i) => ({ i, key: a.key, kind: a.kind, id: a.id, name: a.name, available: a.available, now: !!a.command, reason: a.reason?.message ?? null })); },
  aim() { const a = __arena.tactical.aiming; return a ? { key: a.key, cells: [...a.cells.values()].map(t => ({ c: t.cell, valid: t.valid, reason: t.reason?.message ?? null })) } : null; },
  hover() { return __arena.tactical.hoverCell; },
  scr(c) { return __arena.cellToScreen(c); },
  onCanvas(x, y) { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS'; },
  rect(sel, text) { const els = [...document.querySelectorAll(sel)].filter(e => !text || e.textContent.includes(text)); const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!e.disabled }; },
  images() { return [...document.querySelectorAll('#hud img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })); },
};`;

function driver(b: Browser) {
  const ev = <T,>(expr: string) => b.ev<T>(expr);
  const waitFor = async (cond: () => Promise<boolean>, ms: number, what: string) => {
    const start = Date.now();
    while (!(await cond())) {
      if (Date.now() - start > ms) throw new Error(`timeout: ${what}`);
      await sleep(200);
    }
  };
  async function load(url: string) {
    await b.send('Page.navigate', { url });
    await waitFor(async () => (await ev<string>('document.body.dataset.ready')) === '1', 120000, `carregar ${url}`);
    await ev(HELPER);
    await sleep(1200);
    await waitIdle();
  }
  async function waitIdle(timeout = 40000) {
    const start = Date.now();
    let calm = 0;
    while (Date.now() - start < timeout) {
      calm = (await ev<boolean>('__arena.match.busy')) ? 0 : calm + 1;
      if (calm >= 3) return;
      await sleep(120);
    }
    throw new Error('timeout esperando a animação');
  }
  const SAFE = { x0: 40, x1: 1360, y0: 70, y1: 720 };
  async function ensureVisible(c: Coord) {
    for (let i = 0; i < 6; i++) {
      const p = await ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
      if (p.x > SAFE.x0 && p.x < SAFE.x1 && p.y > SAFE.y0 && p.y < SAFE.y1 && (await ev<boolean>(`__drv.onCanvas(${p.x}, ${p.y})`))) return p;
      await b.drag(Math.max(200, Math.min(1200, p.x)), Math.max(200, Math.min(680, p.y)), 700, 420);
      await sleep(400);
    }
    return ev<{ x: number; y: number }>(`__drv.scr(${JSON.stringify(c)})`);
  }
  const same = (a: Coord | null, c: Coord) => !!a && a.x === c.x && a.y === c.y && (a.floor ?? 0) === (c.floor ?? 0);
  async function hoverCell(c: Coord) {
    const offs = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [0, -16], [6, 12], [-10, -14]];
    for (let turn = 0; turn < 4; turn++) {
      const p = await ensureVisible(c);
      for (const [dx, dy] of offs) {
        await b.move(p.x + dx!, p.y + dy!);
        await sleep(240);
        if (same(await ev<Coord | null>('__drv.hover()'), c)) return { x: p.x + dx!, y: p.y + dy! };
      }
      await b.key('KeyE', 'e', 'e'); // gira a câmera, como um jogador faria
      await sleep(900);
    }
    throw new Error(`picking não achou a célula ${JSON.stringify(c)}`);
  }
  let useKey = true;
  async function chooseCard(key: string) {
    const list = await ev<Array<{ i: number; key: string; available: boolean; now: boolean; reason: string | null }>>('__drv.actions()');
    const a = list.find((x) => x.key === key);
    if (!a) throw new Error(`carta ${key} não está na barra (${list.map((x) => x.key).join(', ')})`);
    if (!a.available) throw new Error(`carta ${key} indisponível: ${a.reason}`);
    if (useKey && a.i < 9) await b.key(`Digit${a.i + 1}`, String(a.i + 1), String(a.i + 1));
    else {
      const r = await ev<{ x: number; y: number }>(`__drv.rect('.action-card[data-index="${a.i}"]')`);
      await b.click(r.x, r.y);
    }
    useKey = !useKey;
    await sleep(250);
    return a;
  }
  return { ev, load, waitIdle, waitFor, hoverCell, chooseCard, b };
}

// ---------------------------------------------------------------------------
const stamp = Date.now();
const AUDIO = ['--autoplay-policy=no-user-gesture-required'];
const br = (await launch({ port: 9361, profile: `${tmpdir()}/bardurinho-conteudo-${stamp}`, width: 1400, height: 900, extraArgs: AUDIO })) as Browser;
const d = driver(br);
const coverage = {
  abilities: new Set<string>(),
  weapons: new Set<string>(),
  consumables: new Set<string>(),
  accessories: new Set<string>(),
  armors: new Set<string>(),
  classes: new Set<string>(),
  statuses: new Set<string>(),
  surfaces: new Set<string>(),
  reactions: new Set<string>(),
  objects: new Set<string>(),
  events: new Set<string>(),
};
const shots: string[] = [];
const shot = async (name: string) => {
  await br.shot(`${OUT}/${name}.png`);
  shots.push(name);
  log('  📷', name);
};

function noteEvents(events: readonly GameEvent[], state: GameState) {
  for (const e of events) {
    coverage.events.add(e.type);
    const p = e.payload;
    if (e.type === 'ABILITY_USED') coverage.abilities.add(String(p.abilityId));
    if (e.type === 'ATTACK_PERFORMED') coverage.weapons.add(String(p.weaponId));
    if (e.type === 'ITEM_USED') coverage.consumables.add(String(p.itemId));
    if (e.type === 'STATUS_APPLIED') coverage.statuses.add(String(p.statusId));
    if (e.type === 'SHIELD_GRANTED' && p.applied) coverage.statuses.add('barrier');
    if (e.type === 'SURFACE_CREATED') coverage.surfaces.add(String(p.surface));
    if (e.type === 'REACTION_TRIGGERED') coverage.reactions.add(String(p.reaction));
    if (e.type === 'EXPLOSION') coverage.objects.add('barrel:explosion');
    if (e.type === 'OBJECT_DAMAGED') coverage.objects.add(`${state.objects[String(p.objectId)]?.defId}:damaged`);
    if (e.type === 'OBJECT_IGNITED') coverage.objects.add(`${state.objects[String(p.objectId)]?.defId}:burning`);
    if (e.type === 'OBJECT_STATE_CHANGED') coverage.objects.add(`${state.objects[String(p.objectId)]?.defId}:${String(p.to)}`);
    if (e.type === 'CONSUMABLE_GRANTED') coverage.objects.add('chest:granted');
  }
}

let exitCode = 0;
try {
  // -------------------------------------------------------------------------
  // 1. Combat Debug Lab: biblioteca de cenários
  // -------------------------------------------------------------------------
  log('== Lab: cenários de tests/scenarios no navegador');
  await br.send('Page.navigate', { url: LAB });
  await d.waitFor(async () => !!(await br.ev<boolean>('!!window.__lab')), 60000, 'Lab carregar');
  const all = await br.ev<Array<{ id: string; failures: string[] }>>('__lab.runAll()');
  const bad = all.filter((x) => x.failures.length);
  check(all.length >= 40 && bad.length === 0, `Lab: ${all.length} cenários conferidos no navegador, ${bad.length} com divergência${bad.length ? ` (${bad.map((x) => x.id).join(', ')})` : ''}`);
  const ids = all.map((x) => x.id);
  const labPick = ['abilities/', 'reactions/', 'objects/'].map((pre) => ids.find((i) => i.startsWith(pre))).filter(Boolean) as string[];
  for (const [i, id] of labPick.entries()) {
    await br.send('Page.navigate', { url: `${LAB}?scenario=${encodeURIComponent(id)}` });
    await d.waitFor(async () => (await br.ev<string>('document.body.dataset.scenario ?? ""')) === id, 30000, `Lab abrir ${id}`);
    await sleep(600);
    check((await br.ev<string>('document.body.dataset.scenarioOk')) === '1', `Lab: cenário ${id} aberto pela URL, timeline carregada e conforme o expected.json`);
    await shot(`lab-0${i + 1}-${id.replace(/\//g, '_')}`);
  }

  // -------------------------------------------------------------------------
  // 2. Cliente 3D: tela de escolha (2 × 2, as quatro classes)
  // -------------------------------------------------------------------------
  log('== Cliente 3D: tela de escolha de personagens');
  // Fase 5: a raiz abre o jogo completo (login); a escolha local fica em ?mode=local.
  await br.send('Page.navigate', { url: `${WEB}?mode=local` });
  await d.waitFor(async () => (await br.ev<string>('document.body.dataset.setup ?? ""')) === '1' && !!(await br.ev('document.querySelector(".match-setup")')), 60000, 'tela de escolha');
  const clickSel = async (sel: string) => {
    const r = await br.ev<{ x: number; y: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!r) throw new Error(`elemento ${sel} não encontrado`);
    await br.click(r.x, r.y);
    await sleep(150);
  };
  await clickSel('[data-size="2"]');
  await clickSel('[data-team="A"][data-slot="0"][data-pick="accessory"][data-value="accessory.vitality_amulet"]');
  await clickSel('[data-team="A"][data-slot="1"][data-pick="consumable"][data-value="consumable.oil_flask"]');
  await clickSel('[data-team="B"][data-slot="0"][data-pick="accessory"][data-value="accessory.frost_medallion"]');
  await clickSel('[data-team="B"][data-slot="1"][data-pick="class"][data-value="druid"]');
  await sleep(300);
  await shot('01-escolha-2x2');
  await clickSel('[data-act="start"]');
  await d.waitFor(async () => (await br.ev<string>('document.body.dataset.ready ?? ""')) === '1', 120000, 'partida 2 × 2');
  await br.ev(HELPER);
  await sleep(1500);
  await d.waitIdle();
  const st2 = await br.ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
  const classes2 = Object.values(st2.units).map((u) => `${u.team}:${u.classId}`).sort();
  check(classes2.join() === 'A:rogue,A:warrior,B:druid,B:mage', `2 × 2 começou com as quatro classes (${classes2.join(', ')})`);
  check(st2.units['warrior-01']?.maxHp === 118 && st2.units['mage-01']?.resistances.cold === 2, 'acessórios escolhidos aplicados (Amuleto +8 PV, Medalhão da geada)');
  check((await br.ev<string>('location.search')).includes('setup='), 'a escolha fica na URL (?setup=) — Reiniciar mantém');
  for (const u of Object.values(st2.units)) coverage.classes.add(u.classId!);
  await br.ev('__arena.focus.focusOverview(__arena.state.map, 34)');
  await sleep(1500);
  await shot('02-arena-2x2-quatro-classes');

  // -------------------------------------------------------------------------
  // 3. Casos de conteúdo pela interface, conferidos com o core a cada jogada
  // -------------------------------------------------------------------------
  let cooldownBadge = false;
  for (const [ci, k] of CASES.entries()) {
    log(`== Caso ${k.name}: ${k.title}`);
    await d.load(caseUrl(k));
    await br.ev('__pace.speed = 1.6');
    let sim = caseState(k);
    const start = await br.ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
    check(stateHash(start) === stateHash(sim), `[${k.name}] estado inicial do cliente = core (setup + posições + dados em média fixa)`);
    for (const u of Object.values(start.units)) {
      coverage.classes.add(u.classId!);
      if (u.accessoryId) coverage.accessories.add(u.accessoryId);
      if (u.armorId) coverage.armors.add(u.armorId);
    }
    let n = 0;
    for (const step of k.steps) {
      n++;
      const label = `${String(ci + 1)}${String(n).padStart(2, '0')}`;
      if (step.t === 'blocked') {
        const list = await br.ev<Array<{ key: string; available: boolean; reason: string | null }>>('__drv.actions()');
        const a = list.find((x) => x.key === step.key);
        check(!!a && !a.available && (a.reason ?? '').toLowerCase().includes(step.reason), `[${k.name}] ${step.key} indisponível: "${a?.reason}"`);
        if (step.reason === 'recarga') {
          cooldownBadge = (await br.ev<number>('document.querySelectorAll(".action-card .ac-cd").length')) > 0 && (await br.ev<number>('document.querySelectorAll(".hud-cooldowns .cd").length')) > 0;
          check(cooldownBadge, `[${k.name}] recarga visível na barra (⟳N na carta) e no painel do personagem`);
          await shot(`${k.name}-${label}-recarga`);
        }
        continue;
      }
      const cmd = stepCommand(sim, step)!;
      const r = applyCommand(sim, catalog, cmd);
      if (!r.ok) throw new Error(`[${k.name}] passo ${n} inválido no core: ${r.error.message}`);
      const seq0 = await br.ev<number>('__arena.state.nextCommandSeq');
      const note = 'note' in step && step.note ? step.note : null;
      if (step.t === 'end') {
        await br.key('Enter', 'Enter', '\r');
      } else if (step.t === 'move') {
        const p = await d.hoverCell(step.to);
        await br.click(p.x, p.y);
      } else if (step.t === 'interact') {
        const obj = sim.objects[step.object]!;
        const p = await d.hoverCell(obj.pos);
        await br.click(p.x, p.y);
        await sleep(350);
        const name = listActionsOnTarget(sim, catalog, sim.turn.activeUnitId!, step.object).find((x) => x.kind === 'interact')?.name ?? '';
        const btn = await br.ev<{ x: number; y: number; disabled: boolean } | null>(`__drv.rect('.hud-target-actions .ta-btn.ok', ${JSON.stringify(name)})`);
        if (!btn || btn.disabled) throw new Error(`[${k.name}] botão "${name}" não está no painel do alvo`);
        await br.click(btn.x, btn.y);
      } else {
        const a = await d.chooseCard(step.key);
        if (!a.now) {
          const aim = await br.ev<{ cells: Array<{ c: Coord; valid: boolean; reason: string | null }> } | null>('__drv.aim()');
          const cell = aim?.cells.find((t) => t.c.x === step.at!.x && t.c.y === step.at!.y && t.c.floor === step.at!.floor);
          if (!cell?.valid) throw new Error(`[${k.name}] célula ${JSON.stringify(step.at)} não é válida na mira de ${step.key}: ${cell?.reason}`);
          const p = await d.hoverCell(step.at!);
          if (note) await shot(`${k.name}-${label}-mira-${step.key.replace(/[:.]/g, '_')}`);
          await br.click(p.x, p.y);
        }
      }
      if (note) {
        await sleep(step.t === 'card' && step.key.startsWith('ability') ? 700 : 500);
        await shot(`${k.name}-${label}-${(step.t === 'card' ? step.key : step.t === 'interact' ? step.object : step.t).replace(/[:.]/g, '_')}`);
      }
      await sleep(150);
      await d.waitIdle();
      const after = await br.ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
      if (after.nextCommandSeq === seq0) throw new Error(`[${k.name}] passo ${n} (${JSON.stringify(step)}) não foi aceito pelo cliente`);
      sim = r.state;
      noteEvents(r.events, r.state);
      if (stateHash(after) !== stateHash(sim)) {
        const diff = Object.keys(sim.units).filter((id) => JSON.stringify(sim.units[id]) !== JSON.stringify(after.units[id]));
        check(false, `[${k.name}] passo ${n}: estado do cliente ≠ core (unidades divergentes: ${diff.join(', ') || 'objetos/mapa'})`);
        for (const id of diff) {
          const keys = Object.keys(sim.units[id] ?? {}).filter((k2) => JSON.stringify((sim.units[id] as unknown as Record<string, unknown>)[k2]) !== JSON.stringify((after.units[id] as unknown as Record<string, unknown> | undefined)?.[k2]));
          for (const k2 of keys) log(`    ${id}.${k2}: core ${JSON.stringify((sim.units[id] as unknown as Record<string, unknown>)[k2])} · cliente ${JSON.stringify((after.units[id] as unknown as Record<string, unknown> | undefined)?.[k2])}`);
        }
      }
    }
    check(true, `[${k.name}] ${k.steps.length} jogadas pela interface, estado do cliente = core em todas`);
    await br.ev('__arena.focus.focusOverview(__arena.state.map, 30)');
    await sleep(1200);
    await shot(`${k.name}-fim`);
    const imgs = await br.ev<Array<{ src: string; ok: boolean }>>('__drv.images()');
    check(imgs.length > 0 && imgs.every((i) => i.ok), `[${k.name}] ${imgs.length} ícones no HUD carregados (${[...new Set(imgs.map((i) => i.src))].length} distintos)`);
  }

  // Som: os principais efeitos foram pedidos ao WebAudio durante os casos (último caso).
  const counts = await br.ev<Record<string, number>>('__sfx.counts');
  log('  sons (último caso):', JSON.stringify(counts));
  const audible = await br.ev<number>('__sfx.audible');
  check(['explosion', 'water', 'ignite', 'cast.fire', 'door', 'lever', 'focus.restore', 'turn.start'].every((s) => counts[s]! > 0), 'SFX: explosão, água, fogo, conjuração, porta, alavanca, foco e turno tocados no caso "ambiente"');
  check(audible > 0, `SFX: ${audible} sons tocados com o contexto de áudio rodando`);

  // Opções: volume dos efeitos sonoros.
  await br.key('Escape');
  await sleep(300);
  const vol = await br.ev<{ x: number; y: number } | null>(`__drv.rect('input[data-opt="sfxVolume"]')`);
  check(!!vol, 'opções: controle de volume dos efeitos sonoros');
  if (vol) {
    await br.click(vol.x - 60, vol.y);
    await sleep(200);
    await shot('opcoes-volume');
    const v = await br.ev<number>('__sfx.volume');
    check(v > 0 && v < 0.6, `opções: volume alterado pelo controle (${v.toFixed(2)}) e aplicado ao som`);
    await br.key('Escape');
  }
} catch (err) {
  failures.push(String(err instanceof Error ? err.stack ?? err.message : err));
  log('ERRO', err);
  await br.shot(`${OUT}/erro-conteudo.png`).catch(() => undefined);
}
const consoleProblems = [...br.logs];
br.close();

// ---------------------------------------------------------------------------
// 4. Rede: lobby com escolha 2 × 2
// ---------------------------------------------------------------------------
const PORT = 2570;
const SERVER = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: 'memory', TURN_SECONDS: '120', GAME_LOG: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog: string[] = [];
server.stdout.on('data', (x: Buffer) => serverLog.push(x.toString()));
server.stderr.on('data', (x: Buffer) => serverLog.push(x.toString()));
const tabs: Browser[] = [];
try {
  log('== Rede: lobby 2 × 2 com as quatro classes');
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${SERVER}/health`)).ok) break;
    } catch {
      /* subindo */
    }
    if (i > 160) throw new Error('servidor não subiu:\n' + serverLog.join(''));
    await sleep(250);
  }
  for (const [i, who] of ['A', 'B'].entries()) {
    const t = (await launch({ port: 9362 + i, profile: `${tmpdir()}/bardurinho-conteudo-rede-${who}-${stamp}`, width: 1200, height: 860 })) as Browser;
    tabs.push(t);
    await t.send('Page.navigate', { url: `${WEB}?mode=rede&server=${encodeURIComponent(SERVER)}&seed=9` });
  }
  const [A, B] = tabs as [Browser, Browser];
  const clickIn = async (t: Browser, sel: string, text?: string) => {
    for (let i = 0; i < 60; i++) {
      const r = await t.ev<{ x: number; y: number } | null>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => !${JSON.stringify(text ?? '')} || e.textContent.includes(${JSON.stringify(text ?? '')})); if (!e || e.disabled) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (r) {
        await t.click(r.x, r.y);
        await sleep(250);
        return;
      }
      await sleep(250);
    }
    throw new Error(`não achou ${sel} ${text ?? ''}`);
  };
  await clickIn(A, '.hud-lobby .hud-button', 'Jogador A');
  await clickIn(B, '.hud-lobby .hud-button', 'Jogador B');
  for (const [t, c1, c2] of [[A, 'rogue', 'warrior'], [B, 'druid', 'mage']] as const) {
    await clickIn(t, '[data-size="2"]');
    await clickIn(t, `[data-slot="0"][data-pick="class"][data-value="${c1}"]`);
    await clickIn(t, `[data-slot="1"][data-pick="class"][data-value="${c2}"]`);
  }
  await A.shot(`${OUT}/rede-01-lobby-escolha.png`);
  shots.push('rede-01-lobby-escolha');
  await clickIn(A, '.hud-lobby .hud-button', 'Procurar partida');
  await sleep(1500);
  await clickIn(B, '.hud-lobby .hud-button', 'Procurar partida');
  for (const t of [A, B]) {
    for (let i = 0; i < 400; i++) {
      if ((await t.ev<string>('document.body.dataset.ready ?? ""')) === '1' && (await t.ev<string>('__arena?.state?.status ?? ""')) === 'active') break;
      await sleep(300);
    }
  }
  await sleep(2500);
  const sa = await A.ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
  const sb = await B.ev<GameState>('JSON.parse(JSON.stringify(__arena.state))');
  const mine = (s: GameState, team: string) => Object.values(s.units).filter((u) => u.team === team).map((u) => u.classId).sort().join();
  check(sa.status === 'active' && mine(sa, 'A') === 'rogue,warrior', `rede: equipe A começou com Ladino + Guerreiro (${mine(sa, 'A')})`);
  check(sb.status === 'active' && mine(sb, 'B') === 'druid,mage', `rede: equipe B começou com Druida + Mago (${mine(sb, 'B')})`);
  check(Object.values(sa.units).every((u) => u.team === 'A') && Object.values(sb.units).every((u) => u.team === 'B'), 'rede: cada aba só vê a própria equipe no início');
  await A.shot(`${OUT}/rede-02-inicio-equipe-a.png`);
  await B.shot(`${OUT}/rede-03-inicio-equipe-b.png`);
  shots.push('rede-02-inicio-equipe-a', 'rede-03-inicio-equipe-b');
} catch (err) {
  failures.push(`rede: ${String(err instanceof Error ? err.stack ?? err.message : err)}`);
  log('ERRO rede', err);
}
for (const t of tabs) {
  consoleProblems.push(...t.logs.filter((l) => !/Room connection was closed|WebSocket/.test(l)));
  t.close();
}
server.kill();

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------
const items = Object.values(catalog.items);
const need = {
  classes: Object.keys(catalog.classes),
  abilities: Object.keys(catalog.abilities),
  weapons: items.filter((i) => i.kind === 'weapon').map((i) => i.id),
  armors: items.filter((i) => i.kind === 'armor').map((i) => i.id),
  accessories: items.filter((i) => i.kind === 'accessory').map((i) => i.id),
  consumables: items.filter((i) => i.kind === 'consumable').map((i) => i.id),
  statuses: [...Object.keys(catalog.statuses), 'barrier'],
  surfaces: ['oil', 'fire', 'thorns'],
  reactions: ['heat_oil', 'cold_effect_remove_burning', 'water_extinguish_fire', 'water_remove_burning'],
  objects: ['barrel:explosion', 'crate:damaged', 'door:open', 'gate:open', 'lever:open', 'chest:granted', 'focus_altar:used', 'cistern:used'],
} as const;
for (const [k, list] of Object.entries(need)) {
  const have = coverage[k as keyof typeof coverage];
  const missing = list.filter((x) => !have.has(x));
  check(missing.length === 0, `cobertura ${k}: ${list.length - missing.length}/${list.length}${missing.length ? ` — faltam ${missing.join(', ')}` : ''}`);
}
check(consoleProblems.length === 0, `console sem erros/avisos${consoleProblems.length ? `: ${consoleProblems.slice(0, 8).join(' | ')}` : ''}`);
log(`capturas (${shots.length}) em ${OUT}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failures.length) {
  exitCode = 1;
  console.log('\nFALHAS:\n- ' + failures.join('\n- '));
} else console.log('\nE2E de conteúdo: tudo conferido.');
process.exit(exitCode);
