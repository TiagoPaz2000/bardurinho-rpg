/**
 * Cliente web 3D (Babylon.js).
 * Fase 2: Pátio das Ruínas a partir do core, câmera tática, HUD e partida local (os dois lados).
 * Fase 3: modo em rede — `?mode=rede` (lobby → sala no servidor de jogo; o servidor é a
 * autoridade e o cliente só vê a visão da sua equipe). Sem o parâmetro: partida local.
 *
 * Parâmetros do modo em rede: `server=http://127.0.0.1:2567`, `seed=N` e `turn=S` (opções de
 * desenvolvimento para quem cria a sala). Recarregar a página volta à mesma partida
 * (token de reconexão guardado em `sessionStorage`).
 */
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { defaultServerUrl, loadSession, rememberRoom, resumeMatch, saveSession, type Joined } from './network/connect.js';
import { NetworkMatch } from './network/NetworkMatch.js';
import { pace } from './rendering/anim.js';
import { startArenaScreen, type ArenaScreen } from './screens/arenaScreen.js';
import { showLobby } from './screens/lobby.js';
import { encodeSetup, showLocalSetup } from './screens/matchSetup.js';
import './style.css';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'rede' || params.get('mode') === 'network' ? 'rede' : 'local';

function expose(screen: ArenaScreen) {
  // Gancho de depuração (console / screenshots automatizados).
  (window as unknown as { __arena: ArenaScreen }).__arena = screen;
  // Ritmo das animações (capturas: `__pace.speed = 0.25` desacelera 4×).
  (window as unknown as { __pace: typeof pace }).__pace = pace;
  screen.ready
    .then(() => {
      document.body.dataset.ready = '1';
    })
    .catch((err: unknown) => {
      console.error('Falha ao carregar modelos:', err);
      const box = document.createElement('div');
      box.className = 'hud-panel hud-error';
      box.textContent = `Falha ao carregar modelos: ${String(err)}`;
      hudRoot.append(box);
      document.body.dataset.ready = 'error';
    });
}

async function startNetwork() {
  document.body.dataset.mode = 'rede';
  const serverUrl = params.get('server') ?? defaultServerUrl();
  const seed = Number(params.get('seed')) || undefined;
  const turnSeconds = Number(params.get('turn')) || undefined;
  const saved = loadSession();
  let joined: Joined | null = null;
  let notice: string | undefined;
  if (saved?.roomId && saved.serverUrl === serverUrl) {
    joined = await resumeMatch(saved);
    if (joined) rememberRoom(saved, joined.room);
    else {
      notice = 'A partida anterior não pôde ser retomada.';
      saveSession({ serverUrl: saved.serverUrl, token: saved.token, username: saved.username });
    }
  }
  if (!joined) {
    document.body.dataset.lobby = '1';
    joined = await showLobby(hudRoot, { serverUrl, ...(seed ? { seed } : {}), ...(turnSeconds ? { turnSeconds } : {}), ...(notice ? { notice } : {}) });
    delete document.body.dataset.lobby;
  }
  const match = new NetworkMatch(catalog, joined.room, joined.snapshot);
  const leave = () => {
    const s = loadSession();
    if (s) saveSession({ serverUrl: s.serverUrl, token: s.token, username: s.username });
    void joined!.room.leave().finally(() => {
      location.search = '?mode=rede';
    });
  };
  const screen = startArenaScreen(canvas, hudRoot, catalog, patioDasRuinas, { match, leave });
  (window as unknown as { __net: NetworkMatch }).__net = match;
  expose(screen);
}

if (mode === 'rede') {
  startNetwork().catch((err: unknown) => {
    console.error('Falha no modo em rede:', err);
    const box = document.createElement('div');
    box.className = 'hud-panel hud-error';
    box.textContent = `Falha no modo em rede: ${String(err)}`;
    hudRoot.append(box);
  });
} else if (!params.has('setup') && !params.has('seed') && !params.has('units')) {
  // Fase 4: abrir sem parâmetros mostra a escolha de personagens; a partida começa com
  // `?setup=…&seed=…` (o mesmo caminho de "Reiniciar"/"Jogar novamente", que mantêm a escolha).
  document.body.dataset.setup = '1';
  void showLocalSetup(hudRoot, catalog).then((setup) => {
    params.set('setup', encodeSetup(setup));
    params.set('seed', String(1 + Math.floor(Math.random() * (2 ** 31 - 1))));
    location.search = params.toString();
  });
} else {
  expose(startArenaScreen(canvas, hudRoot, catalog, patioDasRuinas));
}
