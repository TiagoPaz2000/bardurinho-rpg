// Partida completa no cliente 3D dirigida por entrada real (mouse no canvas / barra / painel, teclas).
// window.__arena só é LIDO (estado, células alcançáveis, ponto da tela de uma célula).
// Critério de aprovação da Fase 2 (etapa 6). Requer o cliente em http://127.0.0.1:5173 (npm run web).
// Uso: node tools/e2e/partida-ui.mjs [pasta-saida=docs/screenshots/fase-02/passo-6] [seed=7]
// Sai com código ≠ 0 se algum passo falhar; no fim imprime o que foi coberto e os erros do console.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch, sleep } from './cdp.mjs';

const out = process.argv[2] ?? 'docs/screenshots/fase-02/passo-6';
const seed = Number(process.argv[3] ?? 7);
mkdirSync(out, { recursive: true });
const b = await launch({ port: 9341, profile: process.env.CDP_PROFILE ?? `${tmpdir()}/bardurinho-e2e-${Date.now()}` });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shots = [];
const shot = async (name) => { await b.shot(`${out}/${name}.png`); shots.push(name); log('📷', name); };
const covered = new Set();

const HELPER = `window.__drv = {
  st() {
    const s = __arena.state;
    const u = {}; for (const x of Object.values(s.units)) u[x.id] = { pos: x.pos, hp: x.hp, ap: x.ap, mp: x.mp, focus: x.focus, alive: x.alive, team: x.team, shield: x.shield?.amount ?? 0 };
    const o = {}; for (const x of Object.values(s.objects)) o[x.id] = { pos: x.pos, state: x.state, hp: x.hp, defId: x.defId };
    return { status: s.status, active: s.turn.activeUnitId, turnId: s.turn.turnId, round: s.turn.round, seq: s.nextCommandSeq, units: u, objects: o, busy: __arena.match.busy, result: s.result };
  },
  surface(c) { const m = __arena.state.map; const cell = m.cells[c.floor]?.[c.y * m.width + c.x]; return cell?.surface?.kind ?? null; },
  actions() { return __arena.actionBar.list.map((a, i) => ({ i, key: a.key, kind: a.kind, id: a.id, name: a.name, available: a.available, now: !!a.command, reason: a.reason?.message })); },
  aim() { const a = __arena.tactical.aiming; return a ? { key: a.key, cells: [...a.cells.values()].map(t => ({ c: t.cell, valid: t.valid, reason: t.reason?.message ?? null })) } : null; },
  hover() { return __arena.tactical.hoverCell; },
  scr(c) { return __arena.cellToScreen(c); },
  onCanvas(x, y) { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS'; },
  rect(sel, text) { const els = [...document.querySelectorAll(sel)].filter(e => !text || e.textContent.includes(text)); const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!e.disabled }; },
};`;

const st = () => b.ev('__drv.st()');
const same = (a, c) => a && c && a.x === c.x && a.y === c.y && (a.floor ?? 0) === (c.floor ?? 0);
const man = (a, c) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);
async function waitIdle(timeout = 30000) {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < timeout) {
    calm = (await b.ev('__arena.match.busy')) ? 0 : calm + 1;
    if (calm >= 3) return;
    await sleep(120);
  }
  throw new Error('timeout esperando a animação');
}
// Áreas do HUD que não são canvas: o elementFromPoint resolve; margem para o topo/baixo.
const SAFE = { x0: 40, x1: 1360, y0: 60, y1: 740 };
const safe = (p) => p.x > SAFE.x0 && p.x < SAFE.x1 && p.y > SAFE.y0 && p.y < SAFE.y1;
/** Traz a célula para uma área clicável arrastando a câmera com o botão do meio (pan real). */
async function ensureVisible(c) {
  for (let i = 0; i < 6; i++) {
    const p = await b.ev(`__drv.scr(${JSON.stringify(c)})`);
    if (safe(p) && (await b.ev(`__drv.onCanvas(${p.x}, ${p.y})`))) return p;
    // Arrasta "agarrando o chão": do ponto (limitado à tela) para o centro.
    const sx = Math.max(200, Math.min(1200, p.x));
    const sy = Math.max(200, Math.min(700, p.y));
    await b.drag(sx, sy, 700, 420);
    await sleep(400);
  }
  return b.ev(`__drv.scr(${JSON.stringify(c)})`);
}
/** Passa o mouse sobre a célula e confere que o picking acha a mesma célula. */
let rotations = 0;
async function hoverCell(c) {
  const offs = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [0, -16], [6, 12]];
  const seen = [];
  // Célula atrás de um muro: gira a câmera (E) e tenta de novo, como um jogador faria.
  for (let turn = 0; turn < 4; turn++) {
    const p = await ensureVisible(c);
    for (const [dx, dy] of offs) {
      await b.move(p.x + dx, p.y + dy);
      await sleep(260);
      const h = await b.ev('__drv.hover()');
      if (same(h, c)) {
        if (c.x === 2 && c.y === 6 && !shots.includes('09-cursor-atras-da-porta')) { await sleep(400); await shot('09-cursor-atras-da-porta'); }
        return { x: p.x + dx, y: p.y + dy };
      }
      seen.push(h ? `${h.x},${h.y},${h.floor}` : 'nada');
    }
    log(`  célula ${c.x},${c.y},${c.floor} encoberta (cursor em ${[...new Set(seen)].join(' ')}); girando a câmera (E)`);
    if (turn === 0) await b.shot(`${out}/debug-picking-${c.x}-${c.y}.png`);
    await b.key('KeyE', 'e', 'e');
    rotations++;
    await sleep(900);
  }
  throw new Error(`picking não achou a célula ${JSON.stringify(c)}`);
}
async function clickCell(c) {
  const p = await hoverCell(c);
  await b.click(p.x, p.y);
}
async function actionList() { return b.ev('__drv.actions()'); }
/** Escolhe uma carta da barra: atalho numérico (alternando com clique na carta). */
let useKey = true;
async function chooseCard(pred) {
  const list = await actionList();
  const a = list.find(pred);
  if (!a || !a.available) return null;
  if (useKey && a.i < 9) await b.key(`Digit${a.i + 1}`, String(a.i + 1), String(a.i + 1));
  else {
    const r = await b.ev(`__drv.rect('.action-card[data-index="${a.i}"]')`);
    await b.click(r.x, r.y);
  }
  useKey = !useKey;
  await sleep(250);
  return a;
}
/** Ação com alvo: entra na mira, confere a célula válida e clica nela. */
async function fireAt(pred, target, { midShots } = {}) {
  const a = await chooseCard(pred);
  if (!a) return false;
  if (a.now) { await waitIdle(); return true; }
  const aim = await b.ev('__drv.aim()');
  if (!aim) return false;
  const cell = aim.cells.find((t) => same(t.c, target));
  if (!cell || !cell.valid) {
    await b.key('Escape');
    await sleep(200);
    return false;
  }
  const before = (await st()).seq;
  const p = await hoverCell(target);
  await b.click(p.x, p.y);
  if (midShots) for (const [ms, name] of midShots) { await sleep(ms); await shot(name); }
  await waitIdle();
  return (await st()).seq > before;
}
async function moveToward(unitId, goal, { exclude = () => false, stopAt = 0 } = {}) {
  const s = await st();
  const me = s.units[unitId];
  const score = (c) => man(c, goal) + 3 * Math.abs((c.floor ?? 0) - (goal.floor ?? 0));
  if (score(me.pos) <= stopAt) return false;
  const cells = (await b.ev('__arena.reachable()')).filter((c) => !exclude(c));
  // Células do térreo sob as plataformas ficam encobertas com o andar mais alto visualizado.
  const underPlatform = (c) => c.floor === 0 && ((c.x <= 1 && c.y >= 4 && c.y <= 9) || (c.x >= 14 && c.y >= 6 && c.y <= 11));
  const surf = await Promise.all(cells.map((c) => b.ev(`__drv.surface(${JSON.stringify(c)})`)));
  const ok = cells.filter((c, i) => !underPlatform(c) && surf[i] !== 'fire' && score(c) >= stopAt);
  ok.sort((p, q) => score(p) - score(q) || p.cost - q.cost);
  const best = ok[0];
  if (!best || score(best) >= score(me.pos)) return false;
  const before = s.seq;
  log(`  ${unitId} move → (${best.x},${best.y},${best.floor}) custo ${best.cost}`);
  await clickCell(best);
  await sleep(200);
  await waitIdle();
  const after = await st();
  if (after.seq <= before) throw new Error('MOVE não foi aceito');
  covered.add('move');
  return true;
}
async function endTurn(viaButton) {
  const s0 = await st();
  if (s0.status !== 'active') return;
  if (viaButton) {
    const r = await b.ev(`__drv.rect('.hud-turn .hud-button', 'Encerrar turno')`);
    await b.click(r.x, r.y);
  } else await b.key('Enter', 'Enter', '\r');
  await sleep(300);
  await waitIdle();
  const s1 = await st();
  if (s1.turnId === s0.turnId && s1.status === 'active') throw new Error('END_TURN não foi aceito');
}

// -------------------------------------------------------------------------------------------
await b.send('Page.navigate', { url: `http://127.0.0.1:5173/?seed=${seed}` });
for (let i = 0; i < 160; i++) { if ((await b.ev('document.body.dataset.ready')) === '1') break; await sleep(500); }
await b.ev(HELPER);
await sleep(1500);
await waitIdle();

// --- Opções: Esc abre; câmera automática Reduzida → Alta, ritmo Rápido; persistência ---
await b.key('Escape');
await sleep(300);
if (!(await b.ev('__arena.options.isOpen'))) throw new Error('Esc não abriu as opções');
const optBtn = async (opt, value) => {
  const r = await b.ev(`__drv.rect('[data-opt="${opt}"]${value ? `[data-value="${value}"]` : ''}')`);
  await b.click(r.x, r.y);
  await sleep(200);
};
await optBtn('autoCamera', 'reduced');
if ((await b.ev('__arena.cameraEvents.preference')) !== 'reduced') throw new Error('preferência não aplicada');
await optBtn('fast', 'fast');
await optBtn('cameraShake'); // desliga
await optBtn('cameraShake'); // religa
await shot('01-opcoes');
await optBtn('autoCamera', 'high');
const saved = await b.ev(`localStorage.getItem('bardurinho.settings') + ' | ' + localStorage.getItem('bardurinho.pace')`);
log('opções guardadas:', saved);
await b.key('Escape');
await sleep(300);
if (await b.ev('__arena.options.isOpen')) throw new Error('Esc não fechou as opções');
covered.add('options');

// Recarrega para conferir que a preferência persistiu (mesma semente).
await b.send('Page.navigate', { url: `http://127.0.0.1:5173/?seed=${seed}` });
for (let i = 0; i < 160; i++) { if ((await b.ev('document.body.dataset.ready')) === '1') break; await sleep(500); }
await b.ev(HELPER);
await sleep(1500);
await waitIdle();
const persisted = await b.ev('({ pref: __arena.cameraEvents.preference, fast: __pace.fast, s: __arena.settings })');
log('após recarregar:', JSON.stringify(persisted));
if (!persisted.fast || persisted.pref !== 'high') throw new Error('preferências não persistiram');
// Acelera só a duração das animações da reprodução para o roteiro (depuração; o ritmo "rápido" foi escolhido na tela).
await b.ev('__pace.speed = 3');

// --- Planos por personagem ---
const W = 'warrior-01';
const M = 'mage-01';
const plan = { w: 'crate', m: 'oil', pushed: false, losShown: false, upShot: false };
const isWarrior = (id) => id === W;

async function warriorTurn() {
  let s = await st();
  const me = () => s.units[W];
  const refresh = async () => (s = await st());
  // 1) Destruir o caixote (6,3): ir para (6,2) e atacar com a espada.
  if (plan.w === 'crate') {
    const crate = s.objects['crate-01'];
    if (crate.state !== 'destroyed') {
      if (!same(me().pos, { x: 6, y: 2, floor: 0 })) await moveToward(W, { x: 6, y: 2, floor: 0 });
      await refresh();
      for (let k = 0; k < 2 && s.objects['crate-01'].state !== 'destroyed' && me().ap > 0; k++) {
        const ok = await fireAt((a) => a.kind === 'attack', { ...crate.pos, floor: 0 });
        log('  espada no caixote:', ok);
        await refresh();
      }
      if (s.objects['crate-01'].state === 'destroyed') {
        covered.add('destroy-obstacle');
        await shot('05-caixote-destruido');
        plan.w = 'up';
      }
    } else plan.w = 'up';
    if (plan.w === 'crate') return;
  }
  // 2) Subir a escada (0,3) → (0,4, andar 1).
  if (plan.w === 'up') {
    await moveToward(W, { x: 0, y: 4, floor: 1 });
    await refresh();
    if (me().pos.floor === 1) {
      covered.add('stairs-up');
      await shot('07-escada-subiu');
      plan.w = 'down';
    }
    return;
  }
  // 3) Descer e ir até a porta (2,7).
  if (plan.w === 'down') {
    await moveToward(W, { x: 2, y: 6, floor: 0 });
    await refresh();
    if (me().pos.floor === 0) covered.add('stairs-down');
    if (covered.has('stairs-down') && !plan.downShot) { plan.downShot = true; await shot('08-escada-desceu'); }
    if (same(me().pos, { x: 2, y: 6, floor: 0 })) plan.w = 'door';
    else return;
  }
  // 4) Abrir a porta pelo painel do alvo (clique na porta → "Abrir porta").
  if (plan.w === 'door') {
    await refresh();
    if (s.objects['door-01'].state === 'closed' && me().ap > 0) {
      await clickCell({ x: 2, y: 7, floor: 0 });
      await sleep(400);
      const r = await b.ev(`__drv.rect('.ta-btn.ok', 'Abrir')`);
      if (!r) throw new Error('botão "Abrir porta" não apareceu');
      await b.click(r.x, r.y);
      await sleep(500);
      await shot('10-porta-abrindo');
      await waitIdle();
      await refresh();
      if (s.objects['door-01'].state !== 'open') throw new Error('porta não abriu');
      covered.add('open-door');
      // "Mover" volta a selecionar o guerreiro (o painel estava na porta).
      await chooseCard((a) => a.kind === 'move');
    }
    plan.w = 'fight';
  }
  // 5) Combate: investida, espada, empurrão.
  await refresh();
  for (let step = 0; step < 6 && s.status === 'active' && s.active === W; step++) {
    const mage = s.units[M];
    if (!mage.alive) break;
    const dist = man(me().pos, mage.pos);
    if (dist === 1 && me().pos.floor === mage.pos.floor) {
      if (me().ap <= 0) break;
      if (!plan.pushed && covered.has('sword-unit') && (await fireAt((a) => a.id === 'warrior.push', mage.pos))) {
        plan.pushed = true;
        covered.add('ability:warrior.push');
      } else if (await fireAt((a) => a.kind === 'attack', mage.pos)) covered.add('sword-unit');
      else break;
    } else {
      if (me().ap > 0 && dist <= 6 && (await fireAt((a) => a.id === 'warrior.charge', mage.pos, { midShots: covered.has('ability:warrior.charge') ? [] : [[700, '11-investida']] }))) {
        covered.add('ability:warrior.charge');
      } else if (me().mp > 0 && (await moveToward(W, mage.pos, { stopAt: 1 }))) {
        /* aproximou */
      } else break;
    }
    await refresh();
  }
}

async function mageTurn() {
  let s = await st();
  const refresh = async () => (s = await st());
  const me = () => s.units[M];
  if (plan.m === 'oil') {
    // 1) Acender o óleo (11,11) com a Chama concentrada; 2) detonar o barril (10,10) com a varinha.
    await moveToward(M, { x: 11, y: 13, floor: 0 });
    const lit = await fireAt((a) => a.id === 'mage.flame', { x: 11, y: 11, floor: 0 }, { midShots: [[900, '02-chama-no-oleo']] });
    log('  chama no óleo:', lit);
    await refresh();
    if (lit && (await b.ev(`__drv.surface({x:11,y:11,floor:0})`)) === 'fire') { covered.add('ignite-oil'); await shot('03-oleo-em-chamas'); }
    if (s.objects['barrel-02'].state !== 'destroyed') {
      const boom = await fireAt((a) => a.id === 'weapon.arcane_wand' || (a.kind === 'attack'), { x: 10, y: 10, floor: 0 }, { midShots: [[700, '04-barril-explodindo-a'], [500, '04-barril-explodindo-b']] });
      log('  varinha no barril:', boom);
    }
    await refresh();
    if (s.objects['barrel-02'].state === 'destroyed') covered.add('detonate-barrel');
    plan.m = 'los';
    return;
  }
  if (plan.m === 'los') {
    // 3) Linha de visão: mira com alvos atrás do muro mostram o motivo; Esc cancela. Depois a barreira.
    if (await chooseCard((a) => a.id === 'mage.frost_ray' || a.id === 'mage.flame')) {
      const aim = await b.ev('__drv.aim()');
      const wpos = s.units[W].pos;
      const blocked = (aim?.cells ?? []).filter((t) => !t.valid && /vis/i.test(t.reason ?? ''));
      blocked.sort((p, q) => man(p.c, wpos) - man(q.c, wpos));
      if (blocked[0]) {
        await hoverCell(blocked[0].c);
        await sleep(300);
        await shot('06-sem-linha-de-visao');
        log('  célula sem linha de visão:', JSON.stringify(blocked[0]));
        covered.add('line-of-sight');
      }
      await b.key('Escape');
      await sleep(250);
      if (await b.ev('__arena.options.isOpen')) throw new Error('Esc com mira abriu as opções');
    }
    if (await chooseCard((a) => a.id === 'mage.arcane_barrier')) { await waitIdle(); covered.add('ability:mage.arcane_barrier'); }
    plan.m = 'fight';
  }
  // 4) Combate: espera ao sul do muro; quando o guerreiro passa a porta, ataca.
  await refresh();
  for (let step = 0; step < 6 && s.status === 'active' && s.active === M; step++) {
    const w = s.units[W];
    if (!w.alive) break;
    let fired = false;
    if (me().ap > 0) {
      for (const id of ['mage.flame', 'mage.frost_ray', 'weapon.arcane_wand']) {
        const list = await actionList();
        const a = list.find((x) => x.id === id);
        if (!a?.available) continue;
        if (await fireAt((x) => x.id === id, w.pos)) {
          covered.add(id.startsWith('mage.') ? `ability:${id}` : 'wand-unit');
          fired = true;
          break;
        }
      }
    }
    await refresh();
    if (fired) continue;
    if (me().mp <= 0) break;
    const goal = w.pos.y >= 8 && w.pos.floor === 0 ? w.pos : { x: 5, y: 13, floor: 0 };
    if (!(await moveToward(M, goal, { stopAt: w.pos.y >= 8 ? 3 : 0 }))) break;
    await refresh();
  }
}

let guard = 0;
let s = await st();
const t0 = Date.now();
while (s.status === 'active' && guard++ < 80) {
  log(`rodada ${s.round} · vez de ${s.active} · W ${s.units[W].hp} PV @${JSON.stringify(s.units[W].pos)} · M ${s.units[M].hp} PV @${JSON.stringify(s.units[M].pos)}`);
  if (isWarrior(s.active)) await warriorTurn();
  else await mageTurn();
  s = await st();
  if (s.status !== 'active') break;
  await endTurn(guard % 2 === 0);
  s = await st();
}
log('fim:', JSON.stringify(s.result), 'rodada', s.round, 'em', Math.round((Date.now() - t0) / 1000), 's');
await sleep(1500);
const endVisible = await b.ev(`!document.querySelector('.hud-end').hidden`);
log('tela de resultado visível:', endVisible);
await shot('12-vitoria');
if (endVisible) covered.add('victory-screen');

// "Ver a arena" → "Resultado da partida" → "Reiniciar" (mesma semente).
const view = await b.ev(`__drv.rect('[data-view-arena]')`);
if (view) {
  await b.click(view.x, view.y);
  await sleep(500);
  await shot('13-arena-final');
  const res = await b.ev(`__drv.rect('.hud-result-btn')`);
  await b.click(res.x, res.y);
  await sleep(300);
}
const restart = await b.ev(`__drv.rect('[data-restart]')`);
await b.click(restart.x, restart.y);
await sleep(1500);
for (let i = 0; i < 160; i++) { try { if ((await b.ev('document.body.dataset.ready')) === '1') break; } catch { /* navegando */ } await sleep(500); }
await sleep(2500);
const after = await b.ev(`({ url: location.search, status: __arena.state.status, round: __arena.state.turn.round, endHidden: document.querySelector('.hud-end').hidden })`);
log('após reiniciar:', JSON.stringify(after));
if (after.status === 'active' && after.round === 1) covered.add('restart');
await shot('14-reiniciada');

console.log(JSON.stringify({ result: s.result, round: s.round, rotations, covered: [...covered], shots, logs: b.logs }, null, 1));
b.close();
const required = ['options', 'move', 'stairs-up', 'stairs-down', 'open-door', 'ignite-oil', 'detonate-barrel', 'destroy-obstacle', 'line-of-sight', 'victory-screen', 'restart'];
const missing = required.filter((k) => !covered.has(k));
if (missing.length || b.logs.length) {
  console.error('FALHOU — faltou:', missing, 'console:', b.logs);
  process.exit(1);
}
