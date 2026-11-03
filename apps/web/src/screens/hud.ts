/**
 * HUD (HTML sobre o canvas): mapa, rodada, vez e recursos do personagem ativo, andar
 * visualizado, painel da seleção, botão "Encerrar turno", avisos (comando recusado) e
 * ajuda dos controles.
 * Etapa 3: ações sobre o objeto/personagem inspecionado (`listActionsOnTarget`, com
 * botões), painel de iniciativa no início da partida, aviso do modo de habilidade e tela de
 * fim de partida.
 */
import {
  entitiesAt,
  getCell,
  listActionsOnTarget,
  type ActionInfo,
  type Catalog,
  type Coord,
  type EntityId,
  type GameState,
  type GameplayCommand,
  type MapObject,
  type Unit,
} from '@bardurinho/domain';
import type { MatchSummary } from '../game/matchSummary.js';

export type Inspected = { kind: 'cell'; cell: Coord } | { kind: 'unit'; id: EntityId } | { kind: 'object'; id: EntityId };

export interface HudView {
  mapName: string;
  state: GameState;
  viewedFloor: number;
  floors: number;
  orientation: number;
  radius: number;
  grid: boolean;
  /** Personagem selecionado (pode não ser o ativo). */
  selectedUnitId: EntityId | null;
  /** O que o painel de seleção descreve. */
  inspected: Inspected | null;
  /** Animação em andamento (botões desabilitados). */
  busy: boolean;
  /** Modo de habilidade: nome da ação em mira. */
  aiming: string | null;
}

export interface HudActions {
  endTurn: () => void;
  /** Executa um comando pronto (ações sobre o alvo inspecionado). */
  execute: (command: GameplayCommand) => void;
  /** Ação com alvo escolhida no painel (entra no modo de habilidade). */
  aim: (action: ActionInfo) => void;
  /** "Jogar novamente" na tela de fim (semente nova). */
  newMatch: () => void;
  /** "Reiniciar" na tela de fim (mesma semente). */
  restart: () => void;
  /** Botão "Opções" (mesmo que Esc). */
  openOptions: () => void;
  /** Resumo da partida (eventos aceitos) para a tela de resultado. */
  summary: () => MatchSummary;
  /** Alterna o ritmo da reprodução (normal / rápido). */
  toggleSpeed: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const floorLabel = (floor: number, floors: number): string =>
  floor === 0 ? 'térreo' : floor === floors - 1 ? 'plataformas' : `andar ${floor}`;

const TERRAIN_LABEL: Record<string, string> = { ground: 'chão', wall: 'parede', void: 'vazio' };
const OBJECT_STATE_LABEL: Record<MapObject['state'], string> = {
  normal: 'normal',
  open: 'aberto',
  closed: 'fechado',
  destroyed: 'destruído',
  used: 'usado',
};

const row = (label: string, value: string) => `<div class="row"><span class="label">${label}</span><span>${value}</span></div>`;

export class Hud {
  private readonly info: HTMLDivElement;
  private readonly selection: HTMLDivElement;
  private readonly endTurnBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly optionsBtn: HTMLButtonElement;
  private readonly resultBtn: HTMLButtonElement;
  private readonly toasts: HTMLDivElement;
  private readonly targetBox: HTMLDivElement;
  private help!: HTMLDivElement;
  private readonly initiative: HTMLDivElement;
  private readonly endOverlay: HTMLDivElement;
  private readonly modeBanner: HTMLDivElement;
  private lastInfo = '';
  private lastSelection = '';
  private targetActions: ActionInfo[] = [];
  private targetKey = '';
  private endShown = false;

  constructor(
    root: HTMLElement,
    private readonly catalog: Catalog,
    private readonly actions: HudActions,
  ) {
    root.innerHTML = '';
    this.info = document.createElement('div');
    this.info.className = 'hud-panel hud-info';
    this.selection = document.createElement('div');
    this.selection.className = 'hud-panel hud-selection';
    this.selection.hidden = true;
    this.targetBox = document.createElement('div');
    this.targetBox.className = 'hud-target-actions';
    this.targetBox.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
      const x = btn ? this.targetActions[Number(btn.dataset.index)] : undefined;
      if (!x || !x.available) return;
      btn!.blur();
      if (x.command) this.actions.execute(x.command as GameplayCommand);
      else this.actions.aim(x);
    });
    this.initiative = document.createElement('div');
    this.initiative.className = 'hud-panel hud-initiative';
    this.initiative.hidden = true;
    this.endOverlay = document.createElement('div');
    this.endOverlay.className = 'hud-end';
    this.endOverlay.hidden = true;
    this.endOverlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button[data-new-match]')) this.actions.newMatch();
      else if (t.closest('button[data-restart]')) this.actions.restart();
      else if (t.closest('button[data-view-arena]')) {
        // Fecha o resultado para ver a arena; o botão "Resultado" do HUD reabre.
        this.endOverlay.hidden = true;
        this.resultBtn.hidden = false;
      }
    });
    this.modeBanner = document.createElement('div');
    this.modeBanner.className = 'hud-mode';
    this.modeBanner.hidden = true;

    const turnBox = document.createElement('div');
    turnBox.className = 'hud-panel hud-turn';
    this.endTurnBtn = document.createElement('button');
    this.endTurnBtn.className = 'hud-button';
    this.endTurnBtn.type = 'button';
    this.endTurnBtn.innerHTML = 'Encerrar turno <kbd>Enter</kbd>';
    this.endTurnBtn.addEventListener('click', () => {
      this.endTurnBtn.blur();
      actions.endTurn();
    });
    this.speedBtn = document.createElement('button');
    this.speedBtn.className = 'hud-button hud-speed';
    this.speedBtn.type = 'button';
    this.speedBtn.title = 'Ritmo das animações (rápido = metade do tempo)';
    this.speedBtn.addEventListener('click', () => {
      this.speedBtn.blur();
      actions.toggleSpeed();
    });
    this.setFast(false);
    this.optionsBtn = document.createElement('button');
    this.optionsBtn.className = 'hud-button hud-speed hud-options-btn';
    this.optionsBtn.type = 'button';
    this.optionsBtn.innerHTML = 'Opções <kbd>Esc</kbd>';
    this.optionsBtn.addEventListener('click', () => {
      this.optionsBtn.blur();
      actions.openOptions();
    });
    this.resultBtn = document.createElement('button');
    this.resultBtn.className = 'hud-button hud-result-btn';
    this.resultBtn.type = 'button';
    this.resultBtn.textContent = 'Resultado da partida';
    this.resultBtn.hidden = true;
    this.resultBtn.addEventListener('click', () => {
      this.resultBtn.blur();
      this.resultBtn.hidden = true;
      this.endOverlay.hidden = false;
    });
    turnBox.append(this.optionsBtn, this.speedBtn, this.resultBtn, this.endTurnBtn);

    this.toasts = document.createElement('div');
    this.toasts.className = 'hud-toasts';

    const help = document.createElement('div');
    help.className = 'hud-panel hud-help collapsed';
    help.innerHTML = `
      <div class="help-head"><kbd>H</kbd> controles</div>
      <table>
        <tr><td>clique esquerdo</td><td>selecionar / mover / confirmar alvo</td></tr>
        <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>ações da barra (alvo: modo de habilidade)</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>cancelar mira · sem mira: opções</td></tr>
        <tr><td>clique direito</td><td>cancelar mira · limpar seleção</td></tr>
        <tr><td><kbd>Enter</kbd> / <kbd>Espaço</kbd></td><td>encerrar turno</td></tr>
        <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / setas</td><td>mover a câmera</td></tr>
        <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>girar 90°</td></tr>
        <tr><td>scroll</td><td>zoom</td></tr>
        <tr><td>botão do meio / direito + arrastar</td><td>mover a câmera</td></tr>
        <tr><td><kbd>F</kbd></td><td>focar personagem ativo</td></tr>
        <tr><td><kbd>PgUp</kbd> <kbd>PgDn</kbd></td><td>andar visualizado</td></tr>
        <tr><td><kbd>T</kbd></td><td>ritmo das animações (normal / rápido)</td></tr>
        <tr><td><kbd>G</kbd></td><td>grade de debug</td></tr>
        <tr><td><kbd>Home</kbd></td><td>visão geral da arena</td></tr>
      </table>`;
    this.help = help;
    root.append(this.info, this.selection, turnBox, this.toasts, help, this.initiative, this.modeBanner, this.endOverlay);
  }

  /** Rótulo do botão de ritmo. */
  setFast(fast: boolean): void {
    this.speedBtn.innerHTML = `${fast ? 'Rápido ▸▸' : 'Normal ▸'} <kbd>T</kbd>`;
    this.speedBtn.classList.toggle('on', fast);
  }

  /** Aviso temporário (ex.: comando recusado pelo core). */
  toast(message: string, kind: 'error' | 'info' = 'error', ms = 3200): void {
    const el = document.createElement('div');
    el.className = `hud-toast ${kind}`;
    el.textContent = message;
    this.toasts.append(el);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  /** Mostra/oculta a tabela de controles (tecla H). */
  toggleHelp(): void {
    this.help.classList.toggle('collapsed');
  }

  /** Painel de iniciativa (d20 de cada personagem e a ordem resultante). */
  showInitiative(state: GameState, rolls: Array<{ unitId: string; roll: number }>, order: string[], ms = 7000): void {
    const name = (id: string) => {
      const u = state.units[id];
      return u ? this.unitName(u) : esc(id);
    };
    const byId = new Map(rolls.map((r) => [r.unitId, r.roll]));
    this.initiative.innerHTML = `
      <div class="title">Iniciativa (d20)</div>
      ${order.map((id, i) => `<div class="row"><span>${i + 1}º ${name(id)}</span><span class="d20-chip">${byId.get(id) ?? '—'}</span></div>`).join('')}
      <div class="sub">Maior resultado começa; empate mantém a ordem original.</div>`;
    this.initiative.hidden = false;
    this.initiative.classList.remove('out');
    setTimeout(() => {
      this.initiative.classList.add('out');
      setTimeout(() => (this.initiative.hidden = true), 500);
    }, ms);
  }

  /** Tela de fim de partida (vitória/empate) com "Nova partida". */
  private showEnd(state: GameState): void {
    const r = state.result;
    if (!r) return;
    const reasons: Record<string, string> = {
      elimination: 'equipe adversária derrotada',
      surrender: 'rendição',
      mutualDestruction: 'derrota simultânea',
      roundLimit: 'limite de rodadas',
    };
    const why = String((r as { reason?: string }).reason ?? '');
    const title = r.kind === 'victory' ? `Vitória da equipe <span class="team-${esc(r.winnerTeam)}">${esc(r.winnerTeam)}</span>` : 'Empate';
    const sum = this.actions.summary();
    const rows = sum.units
      .map((s) => {
        const u = state.units[s.unitId]!;
        const status = s.alive ? `${s.hp}/${s.maxHp} PV` : '<span class="dead">derrotado</span>';
        const winner = r.kind === 'victory' && s.team === r.winnerTeam ? ' class="winner"' : '';
        return `<tr${winner}><td>${this.unitName(u)} <span class="sub">(${esc(s.team)})</span></td><td>${status}</td><td>${s.damageDealt}</td><td>${s.damageTaken}</td><td>${s.attacks ? `${s.hits}/${s.attacks}` : '—'}</td><td>${s.healing || '—'}</td><td>${s.objectsDestroyed || '—'}</td></tr>`;
      })
      .join('');
    this.endOverlay.innerHTML = `
      <div class="hud-panel end-box">
        <div class="end-kicker">Fim da partida</div>
        <div class="end-title">${title}</div>
        <div class="sub">${esc(reasons[why] ?? why)} · ${sum.rounds} ${sum.rounds === 1 ? 'rodada' : 'rodadas'} · ${sum.turns} turnos · ${sum.commands} comandos</div>
        <table class="end-table">
          <thead><tr><th>Personagem</th><th>Final</th><th title="Dano em personagens causado por ele (inclui fogo/explosões que disparou)">Causou</th><th>Recebeu</th><th title="Jogadas de ataque (d20) que acertaram">Acertos</th><th>Cura</th><th>Objetos</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="end-actions">
          <button type="button" class="hud-button" data-new-match>Jogar novamente</button>
          <button type="button" class="hud-button opt-secondary" data-restart title="Mesma semente dos dados">Reiniciar</button>
          <button type="button" class="hud-button opt-secondary" data-view-arena>Ver a arena</button>
        </div>
      </div>`;
    this.endOverlay.hidden = false;
  }

  private unitName(u: Unit): string {
    // Nome de exibição: a classe (os ids do cenário, como mage-01, não são nomes de jogador).
    const label = u.name && u.name !== u.id ? u.name : this.className(u);
    return `<span class="team-${esc(u.team)}" title="${esc(u.id)}">${esc(label)}</span>`;
  }

  private className(u: Unit): string {
    return u.classId ? (this.catalog.classes[u.classId]?.name ?? u.classId) : 'boneco de teste';
  }

  private resources(u: Unit): string {
    const shield = u.shield ? ` · barreira ${u.shield.amount}` : '';
    return `PV ${u.hp}/${u.maxHp} · PA ${u.ap}/${u.maxAp} · PM ${u.mp}/${u.maxMp} · Foco ${u.focus}/${u.maxFocus}${shield}`;
  }

  update(v: HudView): void {
    const { state } = v;
    const active = state.turn.activeUnitId ? state.units[state.turn.activeUnitId] : undefined;
    let status = '';
    if (state.status === 'finished' && state.result) {
      status = state.result.kind === 'victory' ? `Vitória da equipe ${esc(state.result.winnerTeam)}` : 'Empate';
    }
    const activeHtml = active ? `${this.unitName(active)} (equipe ${esc(active.team)})` : '—';
    const html = `
      <div class="map">${esc(v.mapName)}</div>
      ${status ? `<div class="status">${status}</div>` : ''}
      ${row('Rodada', String(state.turn.round))}
      ${row('Vez de', activeHtml)}
      ${active ? `<div class="resources">${this.resources(active)}</div>` : ''}
      ${row('Andar visualizado', `${v.viewedFloor} — ${floorLabel(v.viewedFloor, v.floors)}${v.viewedFloor === v.floors - 1 ? ' (tudo visível)' : ''}`)}
      ${row('Câmera', `${v.orientation}° · ${v.radius.toFixed(0)} m${v.grid ? ' · grade' : ''}`)}`;
    if (html !== this.lastInfo) {
      this.lastInfo = html;
      this.info.innerHTML = html;
    }

    const sel = this.describe(state, v.inspected, v.floors);
    if (sel !== this.lastSelection) {
      this.lastSelection = sel;
      // O bloco de ações fica fora do innerHTML (mantém os ouvintes).
      const body = document.createElement('div');
      body.innerHTML = sel;
      this.selection.replaceChildren(body, this.targetBox);
      this.selection.hidden = sel === '';
    }
    this.updateTargetActions(state, v);

    if (state.status === 'finished' && !this.endShown) {
      this.endShown = true;
      this.showEnd(state);
    }
    const mode = v.aiming ? `Modo de habilidade: <b>${esc(v.aiming)}</b> — clique num alvo verde · <kbd>Esc</kbd> / clique direito cancela` : '';
    if (this.modeBanner.dataset.html !== mode) {
      this.modeBanner.dataset.html = mode;
      this.modeBanner.innerHTML = mode;
      this.modeBanner.hidden = !mode;
    }

    this.endTurnBtn.disabled = v.busy || state.status !== 'active' || !active;
  }

  /** Ações do personagem da vez sobre o objeto/personagem inspecionado (botões). */
  private updateTargetActions(state: GameState, v: HudView): void {
    const i = v.inspected;
    const actorId = state.status === 'active' ? state.turn.activeUnitId : null;
    const targetId = i && i.kind !== 'cell' ? i.id : null;
    const key = `${state.nextCommandSeq}|${state.turn.turnId}|${actorId}|${targetId}|${v.busy}`;
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.targetActions = actorId && targetId && targetId !== actorId ? listActionsOnTarget(state, this.catalog, actorId, targetId) : [];
    if (this.targetActions.length === 0) {
      this.targetBox.innerHTML = '';
      return;
    }
    const actor = state.units[actorId!]!;
    // Disponíveis primeiro; indisponíveis mostram o motivo.
    const order = this.targetActions.map((x, idx) => ({ x, idx })).sort((a, b) => Number(b.x.available) - Number(a.x.available));
    this.targetBox.innerHTML = `
      <div class="ta-title">Ações de ${this.unitName(actor)} sobre o alvo</div>
      ${order.map(({ x, idx }) => `
        <button type="button" class="ta-btn ${x.available ? 'ok' : 'blocked'}" data-index="${idx}" ${x.available && !v.busy ? '' : 'disabled'}>
          <b>${esc(x.name.replace(/^Ataque: /, 'Atacar: '))}</b><span class="cost">${esc(x.cost)}</span>
          ${x.available ? '' : `<span class="why">${esc(x.reason?.message ?? '')}</span>`}
        </button>`).join('')}`;
  }

  private describe(state: GameState, inspected: Inspected | null, floors: number): string {
    if (!inspected) return '';
    const where = (c: Coord) => `(${c.x}, ${c.y}) · andar ${c.floor} — ${floorLabel(c.floor, floors)}`;
    if (inspected.kind === 'unit') {
      const u = state.units[inspected.id];
      if (!u) return '';
      const statuses = u.statuses.map((s) => esc(this.catalog.statuses[s.statusId]?.name ?? s.statusId)).join(', ');
      const isActive = state.turn.activeUnitId === u.id;
      return `
        <div class="title">${this.unitName(u)}${isActive ? ' <span class="tag">na vez</span>' : ''}${u.alive ? '' : ' <span class="tag dead">derrotado</span>'}</div>
        ${row('Classe', esc(this.className(u)))}
        ${row('Equipe', `<span class="team-${esc(u.team)}">${esc(u.team)}</span>`)}
        ${row('PV', `${u.hp}/${u.maxHp}`)}
        ${row('PA', `${u.ap}/${u.maxAp}`)}
        ${row('PM', `${u.mp}/${u.maxMp}`)}
        ${row('Foco', `${u.focus}/${u.maxFocus}`)}
        ${u.shield ? row('Barreira', String(u.shield.amount)) : ''}
        ${statuses ? row('Estados', statuses) : ''}
        ${row('Posição', where(u.pos))}`;
    }
    if (inspected.kind === 'object') {
      const o = state.objects[inspected.id];
      if (!o) return '';
      const def = this.catalog.objects[o.defId];
      return `
        <div class="title">${esc(def?.name ?? o.defId)}</div>
        ${row('Estado', OBJECT_STATE_LABEL[o.state] + (o.burning ? ' · em chamas' : ''))}
        ${o.hp !== null ? row('PV', `${o.hp}/${o.maxHp ?? '?'}`) : ''}
        ${o.usesLeft !== null ? row('Usos restantes', String(o.usesLeft)) : ''}
        ${row('Posição', where(o.pos))}`;
    }
    const c = inspected.cell;
    const cell = getCell(state.map, c);
    if (!cell) return '';
    const surface = cell.surface ? this.catalog.surfaces[cell.surface.kind] : undefined;
    const surfaceText = cell.surface
      ? `${esc(surface?.name ?? cell.surface.kind)} (entrar: ${surface?.enterCost ?? 1} PM${cell.surface.expiresAtRound !== null ? `, até a rodada ${cell.surface.expiresAtRound}` : ''})`
      : '—';
    const occupants = entitiesAt(state, c)
      .map((e) => (e.entity === 'unit' ? this.unitName(e) : esc(this.catalog.objects[e.defId]?.name ?? e.defId)))
      .join(', ');
    const stairs = state.map.connections.some((k) => [k.a, k.b].some((p) => p.x === c.x && p.y === c.y && p.floor === c.floor));
    return `
      <div class="title">Célula ${where(c)}</div>
      ${row('Terreno', (TERRAIN_LABEL[cell.terrain] ?? cell.terrain) + (cell.dark ? ' · área escura' : '') + (stairs ? ' · escada' : ''))}
      ${row('Superfície', surfaceText)}
      ${row('Ocupantes', occupants || '—')}`;
  }
}
