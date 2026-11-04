/**
 * Fase 6 — desempenho do cliente 3D: `npm run perf:client [-- opções]`.
 *
 * Abre o cliente (`npm run web`, http://127.0.0.1:5173) num Chrome headless, joga partidas
 * locais completas (os dois lados decididos por um `BotBrain` difícil no Node, cada um só com a
 * visão da própria equipe; os comandos entram por `__arena.match.execute`, o mesmo caminho dos
 * cliques, com animações/VFX/sons normais) e mede, quadro a quadro, dentro da página:
 *   - intervalo entre quadros (FPS real) e tempo de CPU do `scene.render()`;
 *   - draw calls (contador do próprio engine, `engine._drawCalls`), índices ativos (≈ triângulos×3),
 *     malhas ativas, partículas ativas e sistemas de partículas ligados;
 * e, a cada comando: malhas/materiais/texturas na cena, memória estimada das texturas e heap JS
 * (depois de um GC forçado pelo CDP) — para detectar vazamento ao longo da partida.
 *
 * Execuções (`--runs=a,b,…`; padrão `duel,stress,2v2`):
 *   duel    1 × 1 Mago × Druida (bots difíceis), Pátio das Ruínas
 *   stress  dois Magos junto do óleo/barris: começa incendiando o óleo das duas manchas (fogo +
 *           2 explosões de barril + superfícies) e segue com os bots até o fim
 *   2v2     2 × 2 Guerreiro+Ladino × Mago+Druida
 * `--gpu` usa a GPU (ANGLE D3D11) em vez do SwiftShader; `--both` mede as duas.
 * `--max=N` limita os comandos por partida (padrão 400). `--url=` troca o cliente.
 *
 * Saída: tabela no console + JSON em `.data/perf/client-<data>.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { projectStateForClient, type GameState, type GameplayCommand } from '@bardurinho/domain';
// @ts-expect-error utilitário em .mjs sem tipos
import { launch, sleep } from '../e2e/cdp.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k!, v ?? '1'];
}));
const BASE = args.url ?? 'http://127.0.0.1:5173/';
const MAX = Number(args.max ?? 400);
const RUNS = (args.runs ?? 'duel,stress,2v2').split(',');
const MODES: boolean[] = args.both ? [false, true] : [!!args.gpu];

interface RunDef { name: string; query: string; prelude?: Record<string, GameplayCommand> }
const RUN_DEFS: Record<string, RunDef> = {
  duel: { name: 'duelo 1×1 Mago × Druida', query: `setup=${encodeURIComponent('A=mage;B=druid')}&seed=4242` },
  stress: {
    name: 'estresse: fogo + 2 explosões, 1×1 Mago × Mago',
    query: `setup=${encodeURIComponent('A=mage;B=mage')}&units=${encodeURIComponent('mage@7,4;mage@8,11')}&seed=777`,
    // No 1º turno de cada lado: Chama concentrada no óleo junto aos barris (mancha 4,4–6 / barril 5,5
    // e mancha 11,9–11 / barril 10,10); depois os bots seguem.
    prelude: {
      A: { type: 'USE_ABILITY', actorId: '', abilityId: 'mage.flame', target: { kind: 'cell', x: 5, y: 5, floor: 0 } },
      B: { type: 'USE_ABILITY', actorId: '', abilityId: 'mage.flame', target: { kind: 'cell', x: 10, y: 10, floor: 0 } },
    },
  },
  '2v2': { name: '2×2 Guerreiro+Ladino × Mago+Druida', query: `setup=${encodeURIComponent('A=warrior|rogue;B=mage|druid')}&seed=9001` },
};

/** Coletor injetado na página (só lê o engine/cena). */
const SAMPLER = `(() => {
  if (window.__perfSampler) return;
  const a = window.__arena, engine = a.engine, scene = a.scene;
  const f = { dt: [], render: [], draws: [], indices: [], meshes: [], particles: [], systems: [] };
  let t0 = 0, last = performance.now();
  scene.onBeforeAnimationsObservable.add(() => { t0 = performance.now(); if (engine._drawCalls) engine._drawCalls.fetchNewFrame(); });
  scene.onAfterRenderObservable.add(() => {
    const now = performance.now();
    f.render.push(now - t0);
    f.dt.push(now - last); last = now;
    const dc = engine._drawCalls; let draws = -1;
    if (dc) draws = dc.current;
    f.draws.push(draws);
    f.indices.push(scene.getActiveIndices());
    f.meshes.push(scene.getActiveMeshes().length);
    let p = 0, s = 0;
    for (const ps of scene.particleSystems) { if (ps.isStarted && ps.isStarted()) { s++; p += ps.getActiveCount(); } }
    f.particles.push(p); f.systems.push(s);
  });
  window.__perfSampler = {
    take() { const out = {}; for (const k in f) { out[k] = f[k]; f[k] = []; } return out; },
    scene() {
      let texBytes = 0, maxTex = 0; const list = [];
      for (const t of scene.textures) { const s = t.getSize ? t.getSize() : null; if (s && s.width) { list.push([t.name.split('/').pop().slice(0, 60), s.width, s.height]); texBytes += s.width * s.height * 4; maxTex = Math.max(maxTex, s.width, s.height); } }
      const gl = engine.getGlInfo ? engine.getGlInfo() : {};
      list.sort((x, y) => y[1] * y[2] - x[1] * x[2]);
      const matNames = {};
      for (const m of scene.materials) { const k = (m.name || '?').replace(/[0-9]+/g, 'N').slice(0, 40); matNames[k] = (matNames[k] || 0) + 1; }
      return { matNames, bigTextures: list.slice(0, 12), meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, texMB: texBytes / 1048576, maxTex,
        particleSystems: scene.particleSystems.length, totalVertices: scene.getTotalVertices(), renderer: gl.renderer, version: gl.version,
        width: engine.getRenderWidth(), height: engine.getRenderHeight(), hardwareScaling: engine.getHardwareScalingLevel() };
    },
  };
})()`;

type Frames = Record<'dt' | 'render' | 'draws' | 'indices' | 'meshes' | 'particles' | 'systems', number[]>;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))]!;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
const r1 = (x: number) => Math.round(x * 10) / 10;

async function runOne(gpu: boolean, def: RunDef, port: number) {
  const b = await launch({ port, profile: `${tmpdir()}/bardurinho-perf-${Date.now()}`, gpu, extraArgs: ['--enable-precise-memory-info'] });
  const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), `[${gpu ? 'gpu' : 'swiftshader'}]`, ...m);
  try {
    await b.send('HeapProfiler.enable');
    const heap = async () => {
      await b.send('HeapProfiler.collectGarbage');
      const h = await b.send('Runtime.getHeapUsage');
      return h.usedSize / 1048576;
    };
    const t0 = Date.now();
    await b.send('Page.navigate', { url: `${BASE}?${def.query}` });
    for (let i = 0; i < 400; i++) {
      const r = await b.ev('document.body?.dataset.ready ?? ""').catch(() => '');
      if (r === '1') break;
      if (r === 'error') throw new Error('falha ao carregar modelos');
      await sleep(250);
    }
    const loadMs = Date.now() - t0;
    await b.ev(SAMPLER);
    await sleep(1500);
    b.ev('__perfSampler.take()'); // descarta o aquecimento
    const scene0 = await b.ev('__perfSampler.scene()');
    const heap0 = await heap();
    log(`${def.name}: carregado em ${loadMs} ms — ${scene0.renderer}`);

    // Quadros parados (sem animação): linha de base.
    await sleep(3000);
    const idle = (await b.ev('__perfSampler.take()')) as Frames;

    const all: Frames = { dt: [], render: [], draws: [], indices: [], meshes: [], particles: [], systems: [] };
    const heavy: Frames = { dt: [], render: [], draws: [], indices: [], meshes: [], particles: [], systems: [] };
    const push = (into: Frames, fr: Frames) => { for (const k of Object.keys(into) as Array<keyof Frames>) into[k].push(...fr[k]); };
    const timeline: Array<{ cmd: number; round: number; heapMB: number; meshes: number; materials: number; textures: number; particleSystems: number; surfaces: number; burning: number; explosions: number }> = [];

    const brains: Record<string, BotBrain> = {
      A: new BotBrain(catalog, 'A', { difficulty: 'hard', seed: 11, explore: exploreTargets(patioDasRuinas, 'A') }),
      B: new BotBrain(catalog, 'B', { difficulty: 'hard', seed: 23, explore: exploreTargets(patioDasRuinas, 'B') }),
    };
    const prelude = new Map(Object.entries(def.prelude ?? {}));
    let commands = 0;
    let rejected = 0;
    let explosions = 0;
    let maxBurning = 0;
    let maxSurfaces = 0;
    let state: GameState = JSON.parse(await b.ev('JSON.stringify(__arena.state)'));
    const tPlay = Date.now();
    while (state.status === 'active' && commands < MAX) {
      const active = state.units[state.turn.activeUnitId!]!;
      let cmd: GameplayCommand;
      const scripted = prelude.get(active.team);
      prelude.delete(active.team);
      if (scripted) cmd = { ...scripted, actorId: active.id } as GameplayCommand;
      else cmd = brains[active.team]!.decide(projectStateForClient(state, catalog, active.team).state).command;
      const err = await b.ev(`__arena.match.execute(${JSON.stringify(cmd)}).then((r) => (r.ok ? null : r.error.message))`, true);
      commands++;
      const fr = (await b.ev('__perfSampler.take()')) as Frames;
      const events: string[] = await b.ev('__arena.match.lastEvents.map((e) => e.type)');
      push(all, fr);
      state = JSON.parse(await b.ev('JSON.stringify(__arena.state)'));
      const surfaces = state.map.cells.flat().filter((c) => c.surface).length;
      const burning = state.map.cells.flat().filter((c) => c.surface?.kind === 'fire').length + Object.values(state.objects).filter((o) => o.burning).length;
      explosions += err ? 0 : events.filter((e) => e === 'EXPLOSION').length;
      maxBurning = Math.max(maxBurning, burning);
      maxSurfaces = Math.max(maxSurfaces, surfaces);
      if (scripted) log(`comando roteirizado ${cmd.type} ${(cmd as { abilityId?: string }).abilityId ?? ''}: ${err ?? 'ok'} (${events.filter((e) => e === 'EXPLOSION').length} explosões, ${burning} em chamas)`);
      if (!err && (events.includes('EXPLOSION') || burning >= 2)) push(heavy, fr);
      if (err) {
        rejected++;
        if (!scripted) brains[active.team]!.rejectedCommand(cmd);
        if (cmd.type === 'END_TURN') break;
      }
      if (commands % 10 === 0 || state.status !== 'active') {
        const sc = await b.ev('__perfSampler.scene()');
        timeline.push({ cmd: commands, round: state.turn.round, heapMB: r1(await heap()), meshes: sc.meshes, materials: sc.materials, textures: sc.textures, particleSystems: sc.particleSystems, surfaces, burning, explosions: events.filter((e) => e === 'EXPLOSION').length });
      }
    }
    const playS = (Date.now() - tPlay) / 1000;
    await sleep(1500);
    const scene1 = await b.ev('__perfSampler.scene()');
    const heap1 = await heap();
    const stats = (fr: Frames) => ({
      frames: fr.dt.length,
      fpsAvg: r1(1000 / avg(fr.dt)),
      fpsP5: r1(1000 / pct(fr.dt, 95)),
      frameMsAvg: r1(avg(fr.dt)),
      frameMsP95: r1(pct(fr.dt, 95)),
      frameMsMax: r1(max(fr.dt)),
      renderCpuMsAvg: r1(avg(fr.render)),
      renderCpuMsP95: r1(pct(fr.render, 95)),
      drawCallsAvg: r1(avg(fr.draws)),
      drawCallsMax: max(fr.draws),
      activeTrisAvg: Math.round(avg(fr.indices) / 3),
      activeTrisMax: Math.round(max(fr.indices) / 3),
      activeMeshesMax: max(fr.meshes),
      particlesMax: max(fr.particles),
      particleSystemsActiveMax: max(fr.systems),
    });
    const out = {
      run: def.name,
      gpu,
      renderer: scene0.renderer,
      resolution: `${scene0.width}×${scene0.height}`,
      loadMs,
      result: state.result,
      rounds: state.turn.round,
      commands,
      rejected,
      explosions,
      maxBurning,
      maxSurfaces,
      playSeconds: r1(playS),
      idle: stats(idle),
      match: stats(all),
      heavy: stats(heavy),
      scene: { start: scene0, end: scene1 },
      heapMB: { start: r1(heap0), end: r1(heap1) },
      timeline,
      consoleErrors: b.logs.filter((l: string) => !l.includes('[warning]')).slice(0, 20),
    };
    log(`${def.name}: ${commands} comandos, ${state.turn.round} rodadas, ${JSON.stringify(state.result)} em ${r1(playS)} s`);
    return out;
  } finally {
    b.close();
    await sleep(500);
  }
}

const results = [];
let port = 9361;
for (const gpu of MODES) for (const r of RUNS) {
  const def = RUN_DEFS[r];
  if (!def) throw new Error(`execução desconhecida: ${r}`);
  results.push(await runOne(gpu, def, port++));
}

mkdirSync('.data/perf', { recursive: true });
const file = `.data/perf/client-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(results, null, 2));

console.log('\n| Execução | Render | Trecho | Quadros | FPS méd. | FPS p5 | Quadro méd./p95 (ms) | CPU render méd./p95 (ms) | Draw calls méd./máx. | Triângulos ativos méd./máx. | Partículas máx. |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  for (const [label, s] of [['parado', r.idle], ['partida', r.match], ['pesado', r.heavy]] as const) {
    if (!s.frames) continue;
    console.log(`| ${r.run} | ${r.gpu ? 'GPU' : 'SwiftShader'} | ${label} | ${s.frames} | ${s.fpsAvg} | ${s.fpsP5} | ${s.frameMsAvg} / ${s.frameMsP95} | ${s.renderCpuMsAvg} / ${s.renderCpuMsP95} | ${s.drawCallsAvg} / ${s.drawCallsMax} | ${s.activeTrisAvg} / ${s.activeTrisMax} | ${s.particlesMax} |`);
  }
}
console.log('\n| Execução | Render | Comandos | Rodadas | Resultado | Heap JS início → fim (MB, após GC) | Malhas início → fim | Materiais | Texturas (mem. est.) | Sistemas de partículas |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const s0 = r.scene.start, s1 = r.scene.end;
  console.log(`| ${r.run} | ${r.gpu ? 'GPU' : 'SwiftShader'} | ${r.commands} | ${r.rounds} | ${r.result ? (r.result.kind === 'victory' ? `vitória ${r.result.winnerTeam}` : 'empate') : '—'} | ${r.heapMB.start} → ${r.heapMB.end} | ${s0.meshes} → ${s1.meshes} | ${s0.materials} → ${s1.materials} | ${s0.textures} → ${s1.textures} (${r1(s1.texMB)} MB, máx. ${s1.maxTex} px) | ${s0.particleSystems} → ${s1.particleSystems} |`);
}
for (const r of results) {
  const a = r.scene.start.matNames as Record<string, number>, z = r.scene.end.matNames as Record<string, number>;
  const grew = Object.entries(z).map(([k, v]) => [k, v - (a[k] ?? 0)] as const).filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]);
  if (grew.length) console.log(`materiais novos ao fim (${r.run}, ${r.gpu ? 'gpu' : 'swiftshader'}): ${grew.map(([k, d]) => `${k} +${d}`).join(', ')}`);
}
for (const r of results) if (r.consoleErrors.length) console.log(`erros no console (${r.run}):`, r.consoleErrors);
for (const r of results) console.log(`renderizador (${r.run}, ${r.gpu ? 'gpu' : 'swiftshader'}): ${r.renderer}`);
console.log(`\nJSON: ${file}`);
