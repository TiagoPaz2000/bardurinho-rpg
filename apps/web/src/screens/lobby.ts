/**
 * Lobby mínimo do modo em rede (Fase 3): login com uma conta, lista de salas e entrada.
 * Contas de desenvolvimento do servidor: `jogador-a` / `jogador-b`, senha `dev`.
 * Resolve com a sala em que o jogador entrou (e o primeiro snapshot).
 */
import { joinMatch, listRooms, login, rememberRoom, saveSession, type Joined, type SavedSession } from '../network/connect.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface LobbyOptions {
  serverUrl: string;
  /** Opções de desenvolvimento para quem cria a sala (`?seed=`, `?turn=`). */
  seed?: number;
  turnSeconds?: number;
  /** Mensagem a mostrar (ex.: a partida anterior não pôde ser retomada). */
  notice?: string;
}

export function showLobby(root: HTMLElement, o: LobbyOptions): Promise<Joined> {
  const box = document.createElement('div');
  box.className = 'hud-lobby';
  root.append(box);
  let session: SavedSession | null = null;
  let message = o.notice ?? '';
  let busy = false;

  return new Promise<Joined>((resolve) => {
    const render = async () => {
      const rooms = session ? await listRooms(o.serverUrl).catch(() => null) : null;
      const open = (rooms ?? []).filter((r) => !r.private && r.metadata?.status === 'setup');
      box.innerHTML = `
        <div class="hud-panel lobby-box">
          <div class="lobby-title">Bardurinho RPG — partida em rede</div>
          <div class="lobby-sub">Servidor <code>${esc(o.serverUrl)}</code></div>
          ${
            session
              ? `<div class="lobby-row">Conectado como <b>${esc(session.username)}</b> <button type="button" class="link" data-act="logout">trocar</button></div>
                 <button type="button" class="hud-button" data-act="quick" ${busy ? 'disabled' : ''}>Procurar partida</button>
                 <div class="lobby-rooms">${
                   rooms === null
                     ? '<div class="sub">Lista de salas indisponível</div>'
                     : open.length
                       ? open
                           .map(
                             (r) =>
                               `<button type="button" class="ta-btn ok" data-room="${esc(r.roomId)}" ${busy ? 'disabled' : ''}><b>Sala ${esc(r.roomId)}</b><span class="cost">${(r.metadata?.seats ?? [])
                                 .map((s) => (s.username ? `${esc(s.team)}: ${esc(s.username)}` : `${esc(s.team)}: livre`))
                                 .join(' · ')}</span></button>`,
                           )
                           .join('')
                       : '<div class="sub">Nenhuma sala esperando jogador — "Procurar partida" cria uma.</div>'
                 }</div>
                 <button type="button" class="link" data-act="refresh">atualizar lista</button>`
              : `<div class="lobby-row">Entrar com uma conta de desenvolvimento:</div>
                 <div class="lobby-accounts">
                   <button type="button" class="hud-button" data-login="jogador-a" ${busy ? 'disabled' : ''}>Jogador A</button>
                   <button type="button" class="hud-button" data-login="jogador-b" ${busy ? 'disabled' : ''}>Jogador B</button>
                 </div>
                 <div class="sub">Contas <code>jogador-a</code> / <code>jogador-b</code>, senha <code>dev</code>. <a href="?mode=local">Partida local</a></div>`
          }
          ${message ? `<div class="lobby-msg">${esc(message)}</div>` : ''}
        </div>`;
    };

    const enter = async (roomId?: string) => {
      if (!session) return;
      busy = true;
      message = 'Entrando na sala…';
      await render();
      try {
        const joined = await joinMatch(o.serverUrl, session.token, { ...(roomId ? { roomId } : {}), ...(o.seed ? { seed: o.seed } : {}), ...(o.turnSeconds ? { turnSeconds: o.turnSeconds } : {}) });
        rememberRoom(session, joined.room);
        box.remove();
        resolve(joined);
      } catch (err) {
        busy = false;
        message = `Não foi possível entrar: ${err instanceof Error ? err.message : String(err)}`;
        await render();
      }
    };

    box.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('button');
      if (!el || busy) return;
      const user = el.dataset.login;
      if (user) {
        busy = true;
        message = '';
        void login(o.serverUrl, user, 'dev')
          .then((r) => {
            session = { serverUrl: o.serverUrl, token: r.token, username: r.account.username };
            saveSession(session);
          })
          .catch((err: unknown) => (message = `Falha no login: ${err instanceof Error ? err.message : String(err)} — o servidor está rodando (npm run server)?`))
          .finally(() => {
            busy = false;
            void render();
          });
        return;
      }
      if (el.dataset.room) return void enter(el.dataset.room);
      if (el.dataset.act === 'quick') return void enter();
      if (el.dataset.act === 'refresh') return void render();
      if (el.dataset.act === 'logout') {
        session = null;
        saveSession(null);
        void render();
      }
    });
    void render();
  });
}
