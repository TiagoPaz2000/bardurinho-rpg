/**
 * Painel do modo em rede (Fase 3): equipe do jogador, conexão, presença do adversário,
 * cronômetro do turno (relógio do servidor), aviso "vez do adversário" e sincronização
 * (versão + hash conferido). Só leitura: nada aqui decide regra.
 */
import type { NetworkMatch } from '../network/NetworkMatch.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class NetworkHud {
  private readonly box: HTMLElement;
  private readonly banner: HTMLElement;
  private last = '';
  private lastBanner = '';

  constructor(
    root: HTMLElement,
    private readonly match: NetworkMatch,
    private readonly actions: { leave(): void },
  ) {
    this.box = document.createElement('div');
    this.box.className = 'hud-panel hud-net';
    this.banner = document.createElement('div');
    this.banner.className = 'hud-net-banner';
    this.banner.hidden = true;
    root.append(this.box, this.banner);
    this.box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="leave"]')) this.actions.leave();
    });
  }

  update(): void {
    const m = this.match;
    const st = m.status;
    const s = m.state;
    const me = st.seats.find((x) => x.seat === m.seat);
    const other = st.seats.find((x) => x.seat !== m.seat);
    const left = m.secondsLeft();
    const mine = s.status === 'active' && m.canControl(s.turn.activeUnitId);
    const conn = st.connection === 'online' ? '<span class="ok">conectado</span>' : st.connection === 'reconnecting' ? '<span class="warn">reconectando…</span>' : '<span class="bad">desconectado</span>';
    const opp = !other?.username ? '<span class="warn">aguardando adversário</span>' : other.connected ? `${esc(other.displayName ?? other.username)} <span class="ok">online</span>` : `${esc(other.displayName ?? other.username)} <span class="warn">fora (vaga reservada)</span>`;
    const timer = left === null ? '—' : `<b class="${left <= 10 ? 'bad' : ''}">${Math.ceil(left)} s</b>`;
    const html = `
      <div class="net-title">Partida em rede · equipe <span class="team-${esc(m.team)}">${esc(m.team)}</span></div>
      <div class="row"><span>Você</span><span>${esc(me?.displayName ?? me?.username ?? '?')} · ${conn}</span></div>
      <div class="row"><span>Adversário</span><span>${opp}</span></div>
      <div class="row"><span>Tempo do turno</span><span data-timer>${timer}</span></div>
      <div class="row"><span>Estado</span><span>v${st.version} · ${st.inSync ? '<span class="ok">hash confere</span>' : '<span class="bad">divergente</span>'}</span></div>
      <button type="button" class="link" data-act="leave">sair da partida</button>`;
    if (html !== this.last) {
      this.last = html;
      this.box.innerHTML = html;
    }
    let banner = '';
    if (s.status === 'setup') banner = 'Aguardando o adversário entrar na sala…';
    else if (s.status === 'active' && !mine) banner = `Vez do adversário${left !== null ? ` — ${Math.ceil(left)} s` : ''}`;
    if (st.connection !== 'online') banner = st.connection === 'reconnecting' ? 'Conexão perdida — reconectando…' : 'Desconectado do servidor';
    if (banner !== this.lastBanner) {
      this.lastBanner = banner;
      this.banner.textContent = banner;
      this.banner.hidden = !banner;
    }
  }
}
