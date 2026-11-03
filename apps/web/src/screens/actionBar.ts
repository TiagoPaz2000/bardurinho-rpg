/**
 * Barra de ações (etapa 3, parte de baixo da tela): cartas das ações do personagem da vez,
 * calculadas pelo core (`listUnitActions`) — disponíveis e indisponíveis com o motivo, custo
 * e atalho (1–9). Tooltip com o mesmo texto do Combat Debug Lab (`describeDefinition` /
 * `BASIC_ACTION_DESCRIPTIONS`).
 *
 * Clique/atalho: ação sem alvo (Defender, Barreira arcana, poções, Encerrar turno) executa na
 * hora; ação com alvo entra no modo de habilidade; "Mover" volta ao modo tático.
 */
import { BASIC_ACTION_DESCRIPTIONS, describeDefinition } from '@bardurinho/content';
import { listUnitActions, type ActionInfo, type Catalog, type GameState } from '@bardurinho/domain';

export interface ActionBarView {
  state: GameState;
  busy: boolean;
  /** Chave da ação em mira (destaque da carta), ou null. */
  aimingKey: string | null;
  /** O personagem da vez é deste cliente; senão a barra some (rede: vez do adversário). */
  controllable?: boolean;
}

export interface ActionBarHandlers {
  /** Carta escolhida (clique ou atalho). */
  choose: (action: ActionInfo) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const KIND_LABEL: Record<ActionInfo['kind'], string> = {
  move: 'movimento',
  defend: 'defesa',
  endTurn: 'turno',
  attack: 'ataque',
  ability: 'habilidade',
  item: 'item',
  interact: 'interação',
};

/** Texto do estado da carta: o que acontece ao escolher. */
export function actionHint(x: ActionInfo): string {
  if (x.kind === 'move') return 'clique numa célula verde';
  if (x.command) return 'executa agora';
  return `escolha o alvo${x.validTargets !== undefined ? ` · ${x.validTargets} válidos` : ''}`;
}

/** Conteúdo do tooltip (mesmo texto do Lab). */
export function actionTooltipHtml(catalog: Catalog, x: ActionInfo, hint = actionHint(x)): string {
  const d = describeDefinition(catalog, x.id) ?? BASIC_ACTION_DESCRIPTIONS[x.id];
  return `
    <div class="tip-title">${esc(x.name)}<span class="tip-cost">${esc(x.cost)}</span></div>
    ${(d?.effects ?? []).map((t) => `<div class="tip-effect">• ${esc(t)}</div>`).join('')}
    ${d?.details.length ? `<div class="tip-details">${d.details.map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    ${x.available
      ? `<div class="tip-status ok">Disponível — ${esc(hint)}</div>`
      : `<div class="tip-status blocked">Indisponível: ${esc(x.reason?.message ?? '')}</div>`}`;
}

export class ActionBar {
  readonly root: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private actions: ActionInfo[] = [];
  private lastState: GameState | null = null;
  private lastKey = '';

  constructor(
    parent: HTMLElement,
    private readonly catalog: Catalog,
    private readonly handlers: ActionBarHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'hud-panel action-bar';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'hud-tooltip';
    this.tooltip.hidden = true;
    parent.append(this.root, this.tooltip);

    this.root.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (!card) return;
      const x = this.actions[Number(card.dataset.index)];
      if (x) this.handlers.choose(x);
    });
    // O tooltip acompanha o cursor sobre as cartas (inclusive indisponíveis).
    this.root.addEventListener('mousemove', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      const x = card ? this.actions[Number(card.dataset.index)] : undefined;
      if (!x) {
        this.tooltip.hidden = true;
        return;
      }
      const html = actionTooltipHtml(this.catalog, x);
      if (this.tooltip.dataset.key !== x.key || this.tooltip.innerHTML.length === 0) {
        this.tooltip.dataset.key = x.key;
        this.tooltip.innerHTML = html;
      }
      this.tooltip.hidden = false;
      const pad = 14;
      const { offsetWidth: w, offsetHeight: h } = this.tooltip;
      let left = e.clientX + pad;
      if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${Math.max(4, e.clientY - h - pad)}px`;
    });
    this.root.addEventListener('mouseleave', () => (this.tooltip.hidden = true));
  }

  /** Ação do atalho `n` (1–9), se houver. */
  hotkey(n: number): ActionInfo | undefined {
    return this.actions[n - 1];
  }

  /** Cartas atuais (depuração/testes). */
  get list(): readonly ActionInfo[] {
    return this.actions;
  }

  /** Chamado a cada quadro; só recalcula quando o estado, a animação ou a mira mudam. */
  private lastControllable: boolean | undefined = undefined;

  update(v: ActionBarView): void {
    const s = v.state;
    if (s !== this.lastState || v.controllable !== this.lastControllable) {
      this.lastState = s;
      this.lastControllable = v.controllable;
      const id = s.status === 'active' && v.controllable !== false ? s.turn.activeUnitId : null;
      this.actions = id ? listUnitActions(s, this.catalog, id) : [];
      this.lastKey = '';
      // Tooltip aberto fica com o texto antigo: reabre no próximo movimento do mouse.
      this.tooltip.dataset.key = '';
    }
    const key = `${v.busy}|${v.aimingKey}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const unit = s.turn.activeUnitId ? s.units[s.turn.activeUnitId] : undefined;
    this.root.hidden = this.actions.length === 0;
    if (!unit) return;
    const cards = this.actions.map((x, i) => {
      const state = !x.available ? 'blocked' : v.aimingKey === x.key ? 'aiming' : 'ok';
      const disabled = v.busy ? ' disabled' : '';
      return `
        <button type="button" class="action-card ${state} kind-${x.kind}${disabled}" data-index="${i}">
          <span class="ac-key">${i < 9 ? i + 1 : ''}</span>
          <span class="ac-kind">${KIND_LABEL[x.kind]}</span>
          <b class="ac-name">${esc(x.name.replace(/^Ataque: /, ''))}</b>
          <span class="ac-cost">${esc(x.cost)}</span>
          <span class="ac-why">${x.available ? esc(v.aimingKey === x.key ? 'mirando — Esc cancela' : actionHint(x)) : esc(x.reason?.message ?? '')}</span>
        </button>`;
    });
    this.root.innerHTML = `
      <div class="ab-title"><span class="team-${esc(unit.team)}">${esc(unit.name && unit.name !== unit.id ? unit.name : (unit.classId ? (this.catalog.classes[unit.classId]?.name ?? unit.classId) : unit.id))}</span> · PA ${unit.ap}/${unit.maxAp} · PM ${unit.mp}/${unit.maxMp} · Foco ${unit.focus}/${unit.maxFocus}</div>
      <div class="ab-cards">${cards.join('')}</div>`;
  }
}
