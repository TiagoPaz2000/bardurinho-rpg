/**
 * E2E da Fase 7 — o **build de produção** como o testador externo o recebe: `npm run start:prod`
 * (vite build + servidor em produção servindo o cliente na mesma porta, sem /debug), um Chrome
 * headless abrindo só o endereço do servidor e **só entrada real**:
 *
 *   privacidade (aceitar) → cadastro com código de convite (errado → recusado; certo → conta)
 *   → personagem → lobby (versão do build) → partida contra o bot até o fim → resultado
 *   → "Reportar bug" (com o registro da partida) → "Revanche" → pesquisa → partida nova
 *   (revanche) → desistir → "Voltar ao lobby" → pesquisa pulada → painel /admin com o token.
 *
 * O painel/API de administração confere o que ficou gravado (pesquisa, bug com anexo, revanche,
 * telemetria). Capturas em docs/screenshots/fase-07/.
 *
 *   npm run e2e:playtest            (gera o build; ~1 min a mais)
 *   E2E_NO_BUILD=1 npm run e2e:playtest
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — utilitário CDP em JS puro (sem tipos)
import { launch, sleep } from './cdp.mjs';
import { driver, type Browser, type Driver } from './uiDriver.js';

const PORT = Number(process.env.E2E_PORT ?? 2581);
const SERVER = `http://127.0.0.1:${PORT}`;
const OUT = process.env.E2E_OUT ?? 'docs/screenshots/fase-07';
const ADMIN = 'e2e-token-de-admin';
const INVITE = 'E2E-CONVITE';
const W = 1280;
const H = 820;
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------------------
// Build de produção + servidor pelo mesmo script do teste externo (start:prod)
// ---------------------------------------------------------------------------
if (!process.env.E2E_NO_BUILD) {
  log('vite build (cliente de produção)…');
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'error'], { cwd: 'apps/web', stdio: 'inherit' });
  if (r.status !== 0) throw new Error('falha no vite build');
}
const server = spawn(process.execPath, ['--import', 'tsx', 'tools/playtest/start.ts', '--no-build'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: 'memory',
    ADMIN_TOKEN: ADMIN,
    REGISTRATION: 'invite',
    INVITE_CODES: `${INVITE}:5`,
    TURN_SECONDS: '90',
    BOT_DELAY_MS: '250',
    GAME_LOG: '1',
  },
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
  if (i > 240) throw new Error('servidor não subiu:\n' + serverLog.join(''));
  await sleep(250);
}
log(`servidor de produção em ${SERVER}`);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  log(`${ok ? 'ok ' : 'FALHOU'} ${what}`);
};
const shots: string[] = [];
async function shot(d: Driver, file: string) {
  await d.b.shot(`${OUT}/${file}.png`);
  shots.push(file);
  log('📷', file);
}
const adminApi = async <T>(path: string): Promise<T> => (await (await fetch(`${SERVER}${path}`, { headers: { Authorization: `Bearer ${ADMIN}` } })).json()) as T;

type Metrics = {
  survey: { responses: number; skipped: number; fun: { mean: number | null } };
  bugs: { total: number; withMatchReport: number };
  rematch: { rematched: number; clicks: number };
  sessions: { count: number; events: number };
  ui: { matchesReported: number };
  matches: { total: number; finished: number };
  players: { total: number; consented: number };
};

let exitCode = 0;
let browser: Browser | null = null;
try {
  // Produção: sem rotas de debug, cadastro só com convite.
  check((await fetch(`${SERVER}/debug/matches`)).status === 404, 'produção: /debug/* desligado (404)');
  const cfg = (await (await fetch(`${SERVER}/playtest/config`)).json()) as { playtest: boolean; registration: string; build: { version: string; commit: string } };
  check(cfg.playtest && cfg.registration === 'invite', 'produção: teste externo ligado e cadastro só com convite');
  const built = (await (await fetch(`${SERVER}/build.json`)).json()) as { version: string; commit: string };
  check(built.version === cfg.build.version, `cliente de produção servido pelo servidor (build v${built.version} · ${built.commit})`);

  browser = (await launch({ port: 9381, profile: `${tmpdir()}/bardurinho-playtest-${Date.now()}`, width: W, height: H })) as Browser;
  const A = driver(browser, 'A', { serverUrl: SERVER, width: W, height: H, log });

  // 1. Privacidade
  await A.load(`${SERVER}/`);
  await A.waitFlow('consent');
  check(await A.exists('[data-consent="yes"]'), 'primeira visita: tela de privacidade/consentimento antes do login');
  await shot(A, '01-consentimento');
  await A.click('[data-consent="yes"]');
  await A.waitFlow('login');
  check((await A.ev<string | null>('JSON.parse(localStorage.getItem("bardurinho.privacidade.v1")).value')) === 'yes', 'consentimento guardado no navegador');

  // 2. Cadastro com código de convite
  await A.click('[data-login-tab="register"]');
  check(await A.exists('input[name="inviteCode"]'), 'cadastro pede o código de convite');
  check(!(await A.exists('a[href="?mode=rede"]')), 'build de produção sem os atalhos de depuração na tela de login');
  const user = `testador${Date.now().toString(36).slice(-5)}`;
  await A.type('input[name="username"]', user);
  await A.type('input[name="displayName"]', 'Testadora');
  await A.type('input[name="password"]', 'senha-segura-1');
  await A.type('input[name="inviteCode"]', 'ERRADO-123');
  await A.click('[data-act="register"]');
  await A.waitFor(async () => ((await A.text('[data-msg]')) ?? '').includes('convite'), 10000, 'erro do convite');
  check(true, 'código de convite errado: cadastro recusado com mensagem');
  await A.type('input[name="inviteCode"]', INVITE.toLowerCase());
  await sleep(300);
  await shot(A, '02-cadastro-convite');
  await A.click('[data-act="register"]');
  await A.waitFlow('character');
  await A.type('input[name="charName"]', 'Lyra Brasa');
  await A.click('[data-class="mage"]');
  await A.click('[data-act="create-char"]');
  await A.waitFlow('lobby');
  const buildText = (await A.text('[data-build]')) ?? '';
  check(buildText.includes(`v${built.version}`) && buildText.includes(built.commit), `versão do build na interface (${buildText})`);
  check(await A.exists('[data-act="bug"]') && (await A.exists('[data-act="privacy"]')), 'lobby: "reportar bug" e "privacidade" no rodapé');
  await shot(A, '03-lobby');

  // 3. Partida contra o bot até o fim
  await A.click('[data-difficulty="easy"]');
  await A.click('[data-act="play-bot"]');
  await A.waitFor(async () => (await A.ev<string>('document.body.dataset.ready ?? ""')) === '1', 120000, 'arena carregada');
  await A.helper();
  await A.waitFor(async () => (await A.state()).status === 'active', 20000, 'início da partida');
  await A.ev('__pace.speed = 3');
  check(await A.exists('.hud-net [data-act="report-bug"]'), 'na partida: "reportar bug" no painel');
  await sleep(1200);
  await shot(A, '04-partida-bot');
  const first = (await A.net()).matchId;
  const turns = await A.playToEnd();
  await A.waitIdle();
  check((await A.state()).status === 'finished', `partida contra o bot terminou (${turns} turnos do jogador)`);
  await A.waitFor(async () => A.exists('.end-box [data-end-action="rematch"]'), 15000, 'resultado com Revanche');
  await sleep(600);
  await shot(A, '05-resultado');

  // 4. Reportar bug (anexa o registro da partida)
  await A.click('.end-box [data-end-action="bug"]');
  await A.waitFlow('bug');
  await A.click('[data-cat="camera"]');
  await A.type('textarea[name="bugText"]', 'A câmera ficou atrás do muro quando o bot explodiu o barril.');
  await A.click('[data-act="bug-send"]');
  await A.waitFor(async () => A.exists('[data-bug-sent]'), 10000, 'bug enviado');
  check(((await A.text('[data-bug-sent]')) ?? '').includes('registro da partida'), 'bug enviado com o registro da partida');
  await shot(A, '06-reportar-bug');
  await A.click('[data-act="bug-close"]');

  // 5. Revanche → pesquisa → partida nova
  await A.click('.end-box [data-end-action="rematch"]');
  await A.waitFlow('survey');
  await A.click('[data-fun="4"]');
  await A.click('[data-clarity="4"]');
  await A.click('[data-camera="3"]');
  await A.click('[data-balance="0"]');
  await A.click('[data-bot-rating="2"]');
  await A.click('[data-again="sim"]');
  await A.type('textarea[name="comment"]', 'Gostei de acender o óleo; a câmera girou rápido demais na explosão.');
  await sleep(300);
  await shot(A, '07-pesquisa');
  await A.click('[data-act="survey-send"]');
  // Revanche: a página recarrega e entra na partida nova (montada pelo servidor).
  await A.waitFor(async () => {
    const ok = (await A.ev<string>('document.body.dataset.ready ?? ""')) === '1' && (await A.ev<boolean>('!!window.__net'));
    if (!ok) return false;
    await A.helper();
    return (await A.net()).matchId !== first;
  }, 120000, 'arena da revanche');
  await A.waitFor(async () => (await A.state()).status === 'active', 20000, 'início da revanche');
  const second = (await A.net()).matchId;
  check(second !== first, `revanche: partida nova (${second.slice(0, 8)}) depois da pesquisa`);
  await sleep(1200);
  await shot(A, '08-revanche');

  // 6. Desiste da revanche → "Voltar ao lobby" → pesquisa pulada
  await A.click('.hud-net [data-act="surrender"]');
  await A.click('.hud-net [data-act="surrender"]', 'confirmar');
  await A.waitFor(async () => (await A.state()).status === 'finished', 20000, 'fim da revanche');
  await A.waitFor(async () => A.exists('.end-box [data-end-action="lobby"]'), 15000, 'resultado da revanche');
  await A.click('.end-box [data-end-action="lobby"]');
  await A.waitFlow('survey');
  await A.click('[data-act="survey-skip"]');
  await A.waitFlow('lobby', 60000);
  check(true, 'voltar ao lobby pergunta a pesquisa (pulada) e volta ao lobby');
  await A.ev('window.dispatchEvent(new Event("pagehide"))'); // envia a fila da telemetria
  await sleep(1500);

  // 7. O que ficou gravado (API de administração)
  const m = await adminApi<Metrics>('/admin/api/metrics');
  check(m.survey.responses === 1 && m.survey.fun.mean === 4, 'servidor: pesquisa gravada (diversão 4)');
  check(m.bugs.total === 1 && m.bugs.withMatchReport === 1, 'servidor: bug com o relatório da partida anexado');
  check(m.rematch.rematched === 1 && m.rematch.clicks >= 1, 'servidor: revanche ligada à partida anterior (rematch_of) e clique registrado');
  check(m.sessions.count >= 1 && m.sessions.events > 5 && m.ui.matchesReported >= 2, `servidor: telemetria do cliente (${m.sessions.events} eventos, ${m.ui.matchesReported} resumos de partida)`);
  check(m.survey.skipped >= 1, 'servidor: pesquisa pulada registrada');
  check(m.players.total === 1 && m.players.consented === 1, 'servidor: consentimento registrado na conta');
  const bugs = await adminApi<Array<{ id: string }>>('/admin/api/bugs');
  const exp = await adminApi<{ format: string; matchId: string }>(`/admin/api/bugs/${bugs[0]!.id}/export`);
  check(exp.format === 'bardurinho.bug-report/1' && exp.matchId === first, 'painel: anexo do bug = relatório da partida (Combat Debug Lab)');
  check((await fetch(`${SERVER}/admin/api/metrics`)).status === 401, 'painel: sem token → 401');

  // 8. Painel /admin no navegador
  await browser.send('Page.navigate', { url: `${SERVER}/admin` });
  await A.waitFor(async () => A.exists('#tok'), 15000, 'painel');
  await A.type('#tok', ADMIN);
  await A.click('#go');
  await A.waitFor(async () => ((await A.text('#report')) ?? '').includes('Métricas principais'), 20000, 'relatório no painel');
  await sleep(500);
  await shot(A, '09-painel-admin');

  // O 403 do cadastro com o código errado é esperado (passo 2).
  const errors = browser.logs.filter((l) => !/favicon|Room connection was closed|WebSocket is closed/.test(l) && !/403 \(Forbidden\).*\/auth\/register/.test(l));
  check(errors.length === 0, `nenhum erro/aviso no console${errors.length ? `:\n${errors.slice(0, 10).join('\n')}` : ''}`);
} catch (err) {
  console.error(err);
  exitCode = 1;
  await browser?.shot(`${OUT}/erro.png`).catch(() => undefined);
} finally {
  browser?.close();
  server.kill();
}

log(`capturas (${shots.length}) em ${OUT}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failures.length || exitCode) {
  console.error(`\nFALHOU (${failures.length}):\n${failures.join('\n')}\n\nlog do servidor:\n${serverLog.join('').split('\n').slice(-40).join('\n')}`);
  process.exit(1);
}
log('E2E do build de produção (teste externo): OK');
process.exit(0);
