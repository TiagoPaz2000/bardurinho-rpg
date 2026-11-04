/**
 * Fase 5 — ciclo completo do jogo no cliente (seção 12.2):
 *
 *   Login / Cadastro → Personagem (criar/escolher, aparência, classe) → Lobby (bot, fila,
 *   convite, loja, equipamento, missões, histórico) → Partida → Resultado → Recompensas → Lobby
 *
 * O cliente só pede; o servidor valida tudo (preço, posse, recompensa, progresso). A sessão da
 * conta fica em `localStorage` (recarregar mantém o login); a sala da partida em
 * `sessionStorage` (recarregar volta à mesma partida).
 *
 * Fase 7 (teste externo, quando o servidor liga `playtest`): tela de privacidade/consentimento,
 * cadastro com código de convite, telemetria (só com consentimento), pesquisa curta depois da
 * partida, "reportar bug" (com o registro da partida) e **revanche** (bot e PvP), versão do build.
 */
import {
  COSMETIC_SLOTS,
  DEFAULT_APPEARANCE,
  DEFAULT_CONSUMABLES,
  MAX_START_CONSUMABLES,
  catalog,
  cosmetics,
  cosmeticsById,
  normalizeChoice,
  patioDasRuinas,
  type CosmeticSlot,
} from '@bardurinho/content';
import type { GameState } from '@bardurinho/domain';
import type { CharacterDto, HistoryEntryDto, LobbyStatusDto, MatchRewardDto, MeResponse, MissionDto, PlaytestConfigDto, ShopItemDto } from '@bardurinho/protocol';
import { BUILD_LABEL, IS_PROD } from '../../build.js';
import { MatchTracker, telemetry } from '../../telemetry/telemetry.js';
import { showBugReport, showConsent, showSurvey } from './playtest.js';
import { ApiError, GameApi, loadAccount, newRequestId, saveAccount } from '../../network/api.js';
import { joinMatch, loadSession, rememberRoom, resumeMatch, saveSession, type Joined, type SavedSession } from '../../network/connect.js';
import { NetworkMatch } from '../../network/NetworkMatch.js';
import { startArenaScreen, type ArenaScreen } from '../arenaScreen.js';
import { classIcon, iconImg, itemIcon } from '../icons.js';
import { portraitHtml } from './portrait.js';
import { CharacterPreview } from './preview3d.js';

const ROOM_KEY = 'bardurinho.jogo';
/** Fase 7: partidas cuja pesquisa já foi mostrada nesta aba (não pergunta de novo ao recarregar). */
const SURVEY_KEY = 'bardurinho.pesquisas';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SLOT_LABEL: Record<CosmeticSlot, string> = { color: 'Cor', outfit: 'Aparência de classe', portrait: 'Retrato', frame: 'Moldura', aura: 'Aura (equipamento)' };
const MODE_LABEL: Record<string, string> = { bot: 'Contra bot', pvp: 'Online (fila)', private: 'Convite', custom: 'Personalizada' };
const DIFF_LABEL: Record<string, string> = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const OUTCOME_LABEL: Record<string, string> = { victory: 'Vitória', defeat: 'Derrota', draw: 'Empate' };

type Tab = 'play' | 'equip' | 'shop' | 'missions' | 'history';

export interface GameFlowOptions {
  serverUrl: string;
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  /** A arena começou (gancho de depuração/e2e). */
  onArena: (screen: ArenaScreen, match: NetworkMatch) => void;
}

export class GameFlow {
  private readonly api: GameApi;
  private readonly box: HTMLDivElement;
  private me: MeResponse | null = null;
  private screen: 'loading' | 'login' | 'character' | 'lobby' = 'loading';
  private message = '';
  private messageKind: 'info' | 'error' = 'info';
  private busy = false;
  // Login
  private loginTab: 'login' | 'register' = 'login';
  private form = { username: '', password: '', displayName: '', inviteTo: '', inviteCode: '' };
  /** Fase 7: configuração do teste externo (servidor). */
  private cfg: PlaytestConfigDto | null = null;
  private rematchTimer: ReturnType<typeof setInterval> | null = null;
  private rematchBox: HTMLDivElement | null = null;
  // Personagem
  private creating = false;
  private draft = { name: '', classId: 'warrior', appearance: { ...DEFAULT_APPEARANCE } as Record<string, string>, accessoryId: null as string | null, consumables: [...DEFAULT_CONSUMABLES] };
  private preview: CharacterPreview | null = null;
  // Lobby
  private tab: Tab = 'play';
  private difficulty = 'easy';
  private status: LobbyStatusDto | null = null;
  private shop: ShopItemDto[] | null = null;
  private missions: MissionDto[] | null = null;
  private history: HistoryEntryDto[] | null = null;
  private equipDraft: { appearance: Record<string, string>; accessoryId: string | null; consumables: string[] } | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private joining = false;

  constructor(private readonly o: GameFlowOptions) {
    const stored = loadAccount();
    this.api = new GameApi(o.serverUrl, stored && stored.serverUrl === o.serverUrl ? stored.token : null);
    telemetry.setToken(this.api.token);
    this.box = document.createElement('div');
    this.box.className = 'hud-lobby flow';
    o.hudRoot.append(this.box);
    this.box.addEventListener('click', (e) => void this.onClick(e));
    this.box.addEventListener('input', (e) => this.onInput(e));
    this.box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        const act = (e.target as HTMLElement).dataset.enter;
        const btn = act ? this.box.querySelector<HTMLButtonElement>(`[data-act="${act}"]`) : null;
        btn?.click();
      }
    });
  }

  /** Ponto de entrada: retoma a partida, ou vai para login / personagem / lobby. */
  async start(): Promise<void> {
    document.body.dataset.flow = 'loading';
    this.render();
    // Fase 7: teste externo — privacidade antes de tudo (uma vez por navegador).
    this.cfg = await this.api.playtestConfig().catch(() => null);
    telemetry.configure(this.o.serverUrl, !!this.cfg?.playtest);
    if (this.cfg?.playtest && telemetry.consent === null) await this.askConsent();
    if (!this.api.token) return this.go('login');
    try {
      this.me = await this.api.me();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        saveAccount(null);
        this.api.token = null;
        return this.go('login');
      }
      this.flash(err, 'error');
      return this.go('login');
    }
    // Recarregou a página no meio da partida: volta para ela.
    const saved = loadSession(ROOM_KEY);
    if (saved?.roomId && saved.serverUrl === this.o.serverUrl) {
      const joined = await resumeMatch(saved);
      if (joined) return this.enterMatch(joined, saved);
      saveSession(null, ROOM_KEY);
    }
    const status = await this.api.lobbyStatus().catch(() => null);
    if (status?.match) return this.join(status.match.roomId);
    this.goHome();
  }

  private goHome() {
    if (!this.me) return this.go('login');
    if (this.me.characters.length === 0 || !this.me.account.activeCharacterId) {
      this.creating = this.me.characters.length === 0;
      return this.go('character');
    }
    this.go('lobby');
  }

  private go(screen: GameFlow['screen']) {
    this.screen = screen;
    document.body.dataset.flow = screen;
    telemetry.track('screen_view', { screen });
    if (screen !== 'lobby') this.stopPoll();
    if (screen === 'lobby') {
      this.startPoll();
      void this.loadTab();
    }
    this.render();
  }

  private flash(msg: unknown, kind: 'info' | 'error' = 'info') {
    this.message = msg instanceof Error ? msg.message : String(msg);
    this.messageKind = kind;
  }

  private get character(): CharacterDto | null {
    return this.me?.characters.find((c) => c.id === this.me!.account.activeCharacterId) ?? null;
  }

  private owned(): string[] {
    return this.me?.inventory ?? [];
  }

  // -------------------------------------------------------------------------
  // Renderização
  // -------------------------------------------------------------------------

  private render(): void {
    const msg = this.message ? `<div class="flow-msg ${this.messageKind}" data-msg>${esc(this.message)}</div>` : '';
    let body = '';
    if (this.screen === 'loading') body = '<div class="flow-title">Bardurinho RPG</div><div class="sub">Conectando…</div>';
    else if (this.screen === 'login') body = this.renderLogin();
    else if (this.screen === 'character') body = this.renderCharacter();
    else body = this.renderLobby();
    // A prévia 3D sobrevive à troca de HTML: o canvas é reaproveitado.
    const keep = this.preview?.canvas;
    this.box.innerHTML = `<div class="hud-panel flow-box flow-${this.screen}" data-screen="${this.screen}">${body}${msg}</div>`;
    const slot = this.box.querySelector<HTMLElement>('[data-preview]');
    if (slot) {
      if (!this.preview) {
        const canvas = document.createElement('canvas');
        canvas.className = 'flow-preview';
        canvas.width = 260;
        canvas.height = 300;
        slot.append(canvas);
        this.preview = new CharacterPreview(canvas);
      } else if (keep) slot.append(keep);
      const c = this.screen === 'character' ? { classId: this.draft.classId, appearance: this.draft.appearance } : { classId: this.character?.classId ?? 'warrior', appearance: this.equipDraft?.appearance ?? this.character?.appearance ?? {} };
      this.preview.show(c.classId, c.appearance);
    } else if (this.preview) {
      this.preview.dispose();
      this.preview = null;
    }
  }

  private renderLogin(): string {
    const reg = this.loginTab === 'register';
    const f = this.form;
    return `
      <div class="flow-title">Bardurinho RPG</div>
      <div class="sub">Arena tática por turnos · Pátio das Ruínas</div>
      <div class="opt-seg flow-tabs">
        <button type="button" data-login-tab="login" class="${reg ? '' : 'on'}">Entrar</button>
        <button type="button" data-login-tab="register" class="${reg ? 'on' : ''}">Criar conta</button>
      </div>
      <label class="flow-field">Usuário<input name="username" autocomplete="username" value="${esc(f.username)}" data-enter="${reg ? 'register' : 'login'}" placeholder="letras minúsculas, números, _ ou -"></label>
      ${reg ? `<label class="flow-field">Nome de exibição<input name="displayName" value="${esc(f.displayName)}" data-enter="register" placeholder="opcional"></label>` : ''}
      ${reg && this.cfg?.registration === 'invite' ? `<label class="flow-field">Código de convite<input name="inviteCode" value="${esc(f.inviteCode)}" data-enter="register" placeholder="recebido de quem te convidou (ex.: BARD-XXXXXX)" autocomplete="off"></label>` : ''}
      ${reg && this.cfg?.registration === 'closed' ? '<div class="flow-msg error">O cadastro está fechado neste servidor.</div>' : ''}
      <label class="flow-field">Senha<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" value="${esc(f.password)}" data-enter="${reg ? 'register' : 'login'}" placeholder="${reg ? 'pelo menos 6 caracteres' : ''}"></label>
      <button type="button" class="hud-button" data-act="${reg ? 'register' : 'login'}" ${this.busy ? 'disabled' : ''}>${reg ? 'Criar conta e entrar' : 'Entrar'}</button>
      ${
        IS_PROD
          ? ''
          : `<div class="sub">Servidor <code>${esc(this.o.serverUrl)}</code> · <a href="?mode=local">partida local (depuração)</a> · <a href="?mode=rede">lobby de desenvolvimento</a></div>`
      }
      ${this.footer(false)}`;
  }

  /** Fase 7: rodapé com a versão do build, privacidade e "reportar bug" (teste externo). */
  private footer(withBug: boolean): string {
    const pt = !!this.cfg?.playtest;
    return `<div class="flow-foot sub"><span data-build>${esc(BUILD_LABEL)}</span>${pt ? ` · <button type="button" class="link" data-act="privacy">privacidade</button>` : ''}${pt && withBug ? ` · <button type="button" class="link" data-act="bug">reportar bug</button>` : ''}</div>`;
  }

  /** Fase 7: tela de privacidade (primeira visita ou pelo rodapé). */
  private async askConsent(): Promise<void> {
    this.box.hidden = true;
    const v = await showConsent(this.o.hudRoot, telemetry.consent);
    this.box.hidden = false;
    telemetry.setConsent(v);
    if (this.api.token) void this.api.setConsent(v === 'yes').catch(() => undefined);
    document.body.dataset.flow = this.screen;
  }

  /** Fase 7: "reportar bug" (com o registro da partida, se houver). */
  private async reportBug(matchId: string | null): Promise<void> {
    telemetry.track('bug_report_open', {}, matchId ?? undefined);
    const sent = await showBugReport(this.o.hudRoot, { matchId, submit: (b) => this.api.reportBug(b) });
    if (sent) telemetry.track('bug_report_submit', {}, matchId ?? undefined);
  }

  private cosmeticOptions(slot: CosmeticSlot, selected: string, attr: string): string {
    const owned = new Set(this.owned());
    return cosmetics
      .filter((c) => c.slot === slot && (c.free || owned.has(c.id)))
      .map((c) => {
        const swatch = c.presentation.tint ? `<i class="swatch" style="background:${c.presentation.tint}"></i>` : c.presentation.ring ? `<i class="swatch" style="background:${c.presentation.ring}"></i>` : c.presentation.border ? `<i class="swatch" style="background:${c.presentation.border}"></i>` : '';
        return `<button type="button" class="ms-opt${c.id === selected ? ' on' : ''}" ${attr}="${slot}" data-value="${c.id}" title="${esc(c.description)}">${swatch}${esc(c.name)}</button>`;
      })
      .join('');
  }

  private loadoutOptions(classId: string, accessoryId: string | null, consumables: string[], prefix: string): string {
    const items = Object.values(catalog.items);
    return `
      <div class="ms-label">Acessório (todos liberados — sem vantagem por progressão)</div>
      <div class="ms-row">
        <button type="button" class="ms-opt${!accessoryId ? ' on' : ''}" data-${prefix}-acc="">Nenhum</button>
        ${items.filter((i) => i.kind === 'accessory').map((a) => `<button type="button" class="ms-opt${a.id === accessoryId ? ' on' : ''}" data-${prefix}-acc="${a.id}">${iconImg(itemIcon(a.id), 'ms-icon-sm')}${esc(a.name)}</button>`).join('')}
      </div>
      <div class="ms-label">Consumíveis iniciais (até ${MAX_START_CONSUMABLES}, tipos diferentes)</div>
      <div class="ms-row">${items
        .filter((i) => i.kind === 'consumable')
        .map((i) => `<button type="button" class="ms-opt${consumables.includes(i.id) ? ' on' : ''}" data-${prefix}-cons="${i.id}">${iconImg(itemIcon(i.id), 'ms-icon-sm')}${esc(i.name)}</button>`)
        .join('')}</div>
      <div class="ms-stats">${this.classStats(classId, accessoryId)}</div>`;
  }

  private classStats(classId: string, accessoryId: string | null): string {
    const cls = catalog.classes[classId];
    if (!cls) return '';
    const acc = accessoryId ? catalog.items[accessoryId] : undefined;
    const armor = catalog.items[cls.loadout.armor];
    const hp = cls.hp + (acc?.kind === 'accessory' ? (acc.maxHpBonus ?? 0) : 0);
    return `PV ${hp} · PA ${cls.ap} · PM ${cls.mp} · Foco ${cls.maxFocus} · Armadura ${armor?.kind === 'armor' ? armor.armor : 0} · Defesa ${cls.defense}`;
  }

  private renderCharacter(): string {
    const me = this.me!;
    if (!this.creating) {
      return `
        <div class="flow-title">Escolha o personagem</div>
        <div class="sub">Conta <b>${esc(me.account.displayName)}</b> · ${me.account.coins} moedas</div>
        <div class="flow-chars">${me.characters
          .map(
            (c) => `<div class="flow-char${c.id === me.account.activeCharacterId ? ' on' : ''}">${portraitHtml(c.classId, c.appearance, 52)}<div><b>${esc(c.name)}</b><div class="sub">${esc(catalog.classes[c.classId]?.name ?? c.classId)}</div></div><button type="button" class="hud-button" data-select-char="${c.id}">Jogar com este</button></div>`,
          )
          .join('')}</div>
        ${me.characters.length < 3 ? '<button type="button" class="hud-button opt-secondary" data-act="new-char">Novo personagem</button>' : '<div class="sub">Limite de 3 personagens por conta.</div>'}
        <button type="button" class="link" data-act="logout">sair da conta</button>`;
    }
    const d = this.draft;
    return `
      <div class="flow-title">Criar personagem</div>
      <div class="flow-cols">
        <div class="flow-col">
          <label class="flow-field">Nome<input name="charName" value="${esc(d.name)}" maxlength="16" placeholder="3 a 16 caracteres" data-enter="create-char"></label>
          <div class="ms-label">Classe</div>
          <div class="ms-row ms-classes">${Object.values(catalog.classes)
            .map((k) => `<button type="button" class="ms-opt${k.id === d.classId ? ' on' : ''}" data-class="${k.id}">${iconImg(classIcon(k.id), 'ms-icon')}<span>${esc(k.name)}</span></button>`)
            .join('')}</div>
          <div class="ms-label">${SLOT_LABEL.color}</div><div class="ms-row">${this.cosmeticOptions('color', d.appearance.color!, 'data-draft-slot')}</div>
          <div class="ms-label">${SLOT_LABEL.outfit}</div><div class="ms-row">${this.cosmeticOptions('outfit', d.appearance.outfit!, 'data-draft-slot')}</div>
          <div class="ms-label">${SLOT_LABEL.portrait}</div><div class="ms-row">${this.cosmeticOptions('portrait', d.appearance.portrait!, 'data-draft-slot')}</div>
          ${this.loadoutOptions(d.classId, d.accessoryId, d.consumables, 'draft')}
        </div>
        <div class="flow-col flow-col-preview"><div data-preview></div>${portraitHtml(d.classId, d.appearance, 64)}</div>
      </div>
      <div class="flow-actions">
        <button type="button" class="hud-button" data-act="create-char" ${this.busy ? 'disabled' : ''}>Criar personagem</button>
        ${me.characters.length ? '<button type="button" class="hud-button opt-secondary" data-act="cancel-char">Voltar</button>' : ''}
      </div>`;
  }

  private renderLobby(): string {
    const me = this.me!;
    const c = this.character!;
    const tabs: Array<[Tab, string]> = [['play', 'Jogar'], ['equip', 'Equipamento'], ['shop', 'Loja'], ['missions', 'Missões'], ['history', 'Histórico']];
    return `
      <div class="flow-head">
        ${portraitHtml(c.classId, c.appearance, 56)}
        <div class="flow-who"><b data-char-name>${esc(c.name)}</b> <span class="sub">${esc(catalog.classes[c.classId]?.name ?? '')}</span>
          <div class="sub">${esc(me.account.displayName)} · código de amigo <code data-friend-code>${esc(me.account.friendCode)}</code></div></div>
        <div class="flow-coins" data-coins="${me.account.coins}">${me.account.coins} <span>moedas</span></div>
        <div class="flow-head-links"><button type="button" class="link" data-act="switch-char">trocar personagem</button><button type="button" class="link" data-act="logout">sair</button></div>
      </div>
      <div class="opt-seg flow-tabs">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`).join('')}</div>
      <div class="flow-tab" data-tab-body="${this.tab}">${this.renderTab()}</div>
      ${this.footer(true)}`;
  }

  private renderTab(): string {
    switch (this.tab) {
      case 'play':
        return this.renderPlay();
      case 'equip':
        return this.renderEquip();
      case 'shop':
        return this.renderShop();
      case 'missions':
        return this.renderMissions();
      case 'history':
        return this.renderHistory();
    }
  }

  private renderPlay(): string {
    const st = this.status;
    const q = st?.queue;
    const incoming = st?.invites.incoming ?? [];
    const outgoing = st?.invites.outgoing ?? [];
    const locked = this.busy || this.joining || !!st?.match;
    return `
      <div class="flow-section">
        <div class="flow-h">Contra o computador</div>
        <div class="opt-seg">${['easy', 'normal', 'hard'].map((d) => `<button type="button" data-difficulty="${d}" class="${this.difficulty === d ? 'on' : ''}">${DIFF_LABEL[d]}</button>`).join('')}</div>
        <button type="button" class="hud-button" data-act="play-bot" ${locked || q ? 'disabled' : ''}>Jogar contra o bot (${DIFF_LABEL[this.difficulty]})</button>
      </div>
      <div class="flow-section">
        <div class="flow-h">Online</div>
        ${
          q
            ? `<div class="flow-queue" data-queue>Procurando adversário… ${q.waitingSeconds} s (${q.size} na fila)</div><button type="button" class="hud-button opt-secondary" data-act="leave-queue">Cancelar busca</button>`
            : `<button type="button" class="hud-button" data-act="queue" ${locked ? 'disabled' : ''}>Procurar partida</button>`
        }
      </div>
      <div class="flow-section">
        <div class="flow-h">Convidar um amigo</div>
        <div class="flow-inline"><input name="inviteTo" value="${esc(this.form.inviteTo)}" placeholder="usuário ou código de amigo" data-enter="invite"><button type="button" class="hud-button" data-act="invite" ${locked ? 'disabled' : ''}>Convidar</button></div>
        ${incoming.map((i) => `<div class="flow-invite" data-invite-in="${i.id}">${i.rematchOf ? 'Pedido de revanche de' : 'Convite de'} <b>${esc(i.from.displayName)}</b> (${esc(i.from.username)}) <button type="button" class="hud-button" data-accept="${i.id}" ${locked ? 'disabled' : ''}>Aceitar</button><button type="button" class="hud-button opt-secondary" data-decline="${i.id}">Recusar</button></div>`).join('')}
        ${outgoing.map((i) => `<div class="flow-invite sub">Convite para ${esc(i.to.displayName)}: ${i.status === 'pending' ? 'aguardando resposta' : i.status === 'declined' ? 'recusado' : i.status === 'accepted' ? 'aceito' : i.status} ${i.status === 'pending' ? `<button type="button" class="link" data-cancel-invite="${i.id}">cancelar</button>` : ''}</div>`).join('')}
      </div>
      ${st?.match ? '<div class="flow-msg info" data-match-found>Partida encontrada — entrando…</div>' : ''}`;
  }

  private renderEquip(): string {
    const c = this.character!;
    const d = (this.equipDraft ??= { appearance: { ...DEFAULT_APPEARANCE, ...c.appearance }, accessoryId: c.accessoryId, consumables: [...c.consumables] });
    const owned = this.owned();
    const changed = JSON.stringify(d) !== JSON.stringify({ appearance: { ...DEFAULT_APPEARANCE, ...c.appearance }, accessoryId: c.accessoryId, consumables: c.consumables });
    return `
      <div class="flow-cols">
        <div class="flow-col">
          ${COSMETIC_SLOTS.map((slot) => `<div class="ms-label">${SLOT_LABEL[slot]}</div><div class="ms-row">${this.cosmeticOptions(slot, d.appearance[slot] ?? DEFAULT_APPEARANCE[slot], 'data-equip-slot')}</div>`).join('')}
          ${this.loadoutOptions(c.classId, d.accessoryId, d.consumables, 'equip')}
          <button type="button" class="hud-button" data-act="save-equip" ${changed && !this.busy ? '' : 'disabled'}>${changed ? 'Salvar equipamento' : 'Equipamento salvo'}</button>
        </div>
        <div class="flow-col flow-col-preview"><div data-preview></div>${portraitHtml(c.classId, d.appearance, 64)}
          <div class="ms-label">Inventário (${owned.length})</div>
          <div class="flow-inventory" data-inventory>${owned.length ? owned.map((id) => `<span class="ms-chip" data-item="${id}">${esc(cosmeticsById[id]?.name ?? id)}</span>`).join('') : '<span class="sub">Nada ainda — compre na loja ou complete missões.</span>'}</div>
        </div>
      </div>`;
  }

  private renderShop(): string {
    if (!this.shop) return '<div class="sub">Carregando a loja…</div>';
    const coins = this.me!.account.coins;
    return `<div class="sub">Só cosméticos: nenhuma compra dá vantagem em combate.</div>
      <div class="flow-shop">${this.shop
        .map((p) => {
          const def = cosmeticsById[p.id];
          const sw = def?.presentation.tint ?? def?.presentation.ring ?? def?.presentation.border ?? def?.presentation.emissive ?? def?.presentation.background;
          return `<div class="flow-product${p.owned ? ' owned' : ''}" data-product="${p.id}">
            <div class="flow-product-top">${sw ? `<i class="swatch big" style="background:${sw}"></i>` : ''}<div><b>${esc(p.name)}</b><div class="sub">${esc(SLOT_LABEL[p.slot as CosmeticSlot] ?? p.slot)}</div></div></div>
            <div class="sub">${esc(p.description)}</div>
            ${p.owned ? '<div class="flow-owned">Possuído</div>' : `<button type="button" class="hud-button" data-buy="${p.id}" ${this.busy || coins < p.price ? 'disabled' : ''}>Comprar · ${p.price} moedas</button>`}
          </div>`;
        })
        .join('')}</div>`;
  }

  private renderMissions(): string {
    if (!this.missions) return '<div class="sub">Carregando missões…</div>';
    const row = (m: MissionDto) => {
      const pct = Math.round((100 * m.progress) / m.target);
      const reward = [m.reward.coins ? `${m.reward.coins} moedas` : '', m.reward.cosmeticName ?? ''].filter(Boolean).join(' + ');
      return `<div class="flow-mission${m.completed ? ' done' : ''}" data-mission="${m.id}" data-progress="${m.progress}">
        <div><b>${esc(m.name)}</b> <span class="sub">${m.period === 'daily' ? 'diária' : 'permanente'} · recompensa: ${esc(reward)}</span></div>
        <div class="sub">${esc(m.description)}</div>
        <div class="flow-bar"><i style="width:${pct}%"></i></div>
        <div class="sub">${m.completed ? 'Concluída — recompensa recebida' : `${m.progress} / ${m.target}`}</div>
      </div>`;
    };
    return this.missions.map(row).join('');
  }

  private renderHistory(): string {
    if (!this.history) return '<div class="sub">Carregando histórico…</div>';
    if (!this.history.length) return '<div class="sub" data-history-empty>Nenhuma partida concluída ainda.</div>';
    return `<table class="end-table flow-history"><thead><tr><th>Quando</th><th>Modo</th><th>Personagem</th><th>Adversário</th><th>Resultado</th><th>Rodadas</th><th>Moedas</th></tr></thead><tbody>${this.history
      .map(
        (h) => `<tr data-history="${h.matchId}"><td>${new Date(h.finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(MODE_LABEL[h.mode] ?? h.mode)}${h.botDifficulty ? ` (${esc(DIFF_LABEL[h.botDifficulty] ?? h.botDifficulty)})` : ''}</td><td>${esc(h.character?.name ?? '—')}</td><td>${esc(h.opponent?.name ?? '—')}${h.opponent?.classId ? ` <span class="sub">${esc(catalog.classes[h.opponent.classId]?.name ?? '')}</span>` : ''}</td><td class="outcome-${h.outcome}">${OUTCOME_LABEL[h.outcome]}</td><td>${h.rounds ?? '—'}</td><td>+${h.coins}</td></tr>`,
      )
      .join('')}</tbody></table>`;
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement;
    if (el.name === 'username') this.form.username = el.value;
    else if (el.name === 'password') this.form.password = el.value;
    else if (el.name === 'displayName') this.form.displayName = el.value;
    else if (el.name === 'inviteTo') this.form.inviteTo = el.value;
    else if (el.name === 'inviteCode') this.form.inviteCode = el.value;
    else if (el.name === 'charName') this.draft.name = el.value;
  }

  private async run(fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    this.render();
    try {
      await fn();
    } catch (err) {
      this.flash(err, 'error');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!el || el.hasAttribute('disabled')) return;
    const d = el.dataset;
    if (d.loginTab) {
      this.loginTab = d.loginTab as 'login' | 'register';
      this.message = '';
      return this.render();
    }
    if (d.class) {
      this.draft.classId = d.class;
      return this.render();
    }
    if (d.draftSlot) {
      this.draft.appearance = { ...this.draft.appearance, [d.draftSlot]: d.value! };
      return this.render();
    }
    if (d.draftAcc !== undefined) {
      this.draft.accessoryId = d.draftAcc || null;
      return this.render();
    }
    if (d.draftCons) {
      this.draft.consumables = toggleConsumable(this.draft.consumables, d.draftCons);
      return this.render();
    }
    if (d.equipSlot && this.equipDraft) {
      this.equipDraft.appearance = { ...this.equipDraft.appearance, [d.equipSlot]: d.value! };
      return this.render();
    }
    if (d.equipAcc !== undefined && this.equipDraft) {
      this.equipDraft.accessoryId = d.equipAcc || null;
      return this.render();
    }
    if (d.equipCons && this.equipDraft) {
      this.equipDraft.consumables = toggleConsumable(this.equipDraft.consumables, d.equipCons);
      return this.render();
    }
    if (d.tab) {
      this.tab = d.tab as Tab;
      this.message = '';
      this.render();
      return void this.loadTab();
    }
    if (d.difficulty) {
      this.difficulty = d.difficulty;
      return this.render();
    }
    if (d.selectChar) return this.run(async () => {
      this.me = await this.api.selectCharacter(d.selectChar!);
      this.equipDraft = null;
      this.go('lobby');
    });
    if (d.buy) return this.run(() => this.buy(d.buy!));
    if (d.accept) return this.run(async () => {
      const r = await this.api.acceptInvite(d.accept!);
      await this.join(r.roomId);
    });
    if (d.decline) return this.run(async () => void (this.status = await this.api.declineInvite(d.decline!)));
    if (d.cancelInvite) return this.run(async () => void (this.status = await this.api.cancelInvite(d.cancelInvite!)));
    switch (d.act) {
      case 'login':
        return this.run(async () => {
          const r = await this.api.login(this.form.username.trim(), this.form.password);
          saveAccount({ serverUrl: this.o.serverUrl, token: r.token, username: r.account.username, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}) });
          this.form.password = '';
          this.afterAuth();
          await this.afterLogin();
        });
      case 'register':
        return this.run(async () => {
          const r = await this.api.register(this.form.username.trim(), this.form.password, this.form.displayName.trim() || undefined, this.form.inviteCode.trim() || undefined);
          saveAccount({ serverUrl: this.o.serverUrl, token: r.token, username: r.account.username, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}) });
          this.form.password = '';
          this.afterAuth();
          this.flash('Conta criada! Você ganhou moedas de boas-vindas.');
          await this.afterLogin();
        });
      case 'logout':
        return this.run(async () => {
          await this.api.logout();
          telemetry.setToken(null);
          saveAccount(null);
          saveSession(null, ROOM_KEY);
          this.me = null;
          this.go('login');
        });
      case 'new-char':
        this.creating = true;
        this.draft = { name: '', classId: 'warrior', appearance: { ...DEFAULT_APPEARANCE }, accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] };
        return this.render();
      case 'cancel-char':
        this.creating = false;
        return this.render();
      case 'switch-char':
        this.creating = false;
        return this.go('character');
      case 'create-char':
        return this.run(async () => {
          const c = this.draft;
          const created = await this.api.createCharacter({ name: c.name.trim(), classId: c.classId, appearance: c.appearance, accessoryId: c.accessoryId, consumables: c.consumables });
          this.me = await this.api.me();
          this.equipDraft = null;
          this.creating = false;
          this.flash(`${created.name} está pronto para a arena.`);
          this.go('lobby');
        });
      case 'save-equip':
        return this.run(async () => {
          const c = this.character!;
          await this.api.updateCharacter(c.id, this.equipDraft!);
          this.me = await this.api.me();
          this.equipDraft = null;
          this.flash('Equipamento salvo.');
        });
      case 'play-bot':
        return this.run(async () => {
          const r = await this.api.playBot(this.difficulty);
          await this.join(r.roomId);
        });
      case 'queue':
        return this.run(async () => {
          this.status = await this.api.joinQueue();
          if (this.status.match) await this.join(this.status.match.roomId);
        });
      case 'leave-queue':
        return this.run(async () => void (this.status = await this.api.leaveQueue()));
      case 'privacy':
        return void this.askConsent().then(() => this.render());
      case 'bug':
        return void this.reportBug(null);
      case 'invite':
        return this.run(async () => {
          const inv = await this.api.invite(this.form.inviteTo.trim());
          this.form.inviteTo = '';
          this.flash(`Convite enviado para ${inv.to.displayName}.`);
          this.status = await this.api.lobbyStatus();
        });
    }
  }

  /** Fase 7: token novo na telemetria e a decisão de privacidade gravada na conta. */
  private afterAuth() {
    telemetry.setToken(this.api.token);
    const c = telemetry.consent;
    if (this.cfg?.playtest && c) void this.api.setConsent(c === 'yes').catch(() => undefined);
  }

  private async afterLogin() {
    this.me = await this.api.me();
    const status = await this.api.lobbyStatus().catch(() => null);
    if (status?.match) return this.join(status.match.roomId);
    this.goHome();
  }

  private async buy(productId: string) {
    const r = await this.api.buy(productId, newRequestId());
    this.me = await this.api.me();
    this.shop = await this.api.shop();
    if (!r.ok) throw new Error(r.error ?? 'Compra recusada');
    this.flash(`Comprado: ${cosmeticsById[productId]?.name ?? productId}. Equipe na aba Equipamento.`);
  }

  private async loadTab() {
    try {
      if (this.tab === 'shop') this.shop = await this.api.shop();
      else if (this.tab === 'missions') this.missions = await this.api.missions();
      else if (this.tab === 'history') this.history = await this.api.history();
      else if (this.tab === 'play') this.status = await this.api.lobbyStatus();
      if (this.screen === 'lobby') this.render();
    } catch (err) {
      this.flash(err, 'error');
      this.render();
    }
  }

  // -------------------------------------------------------------------------
  // Lobby: consulta periódica (fila, convites, partida encontrada)
  // -------------------------------------------------------------------------

  private startPoll() {
    if (this.poll) return;
    this.poll = setInterval(() => void this.tick(), 1000);
  }

  private stopPoll() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private async tick() {
    if (this.screen !== 'lobby' || this.joining) return;
    try {
      const st = await this.api.lobbyStatus();
      const before = JSON.stringify(this.status);
      this.status = st;
      if (st.match) return void (await this.join(st.match.roomId));
      // Não redesenha com um campo de texto em edição (perderia o foco).
      if (this.tab === 'play' && before !== JSON.stringify(st) && document.activeElement?.tagName !== 'INPUT') this.render();
    } catch {
      /* servidor fora do ar: tenta de novo no próximo segundo */
    }
  }

  // -------------------------------------------------------------------------
  // Partida
  // -------------------------------------------------------------------------

  private async join(roomId: string) {
    if (this.joining) return;
    this.joining = true;
    this.flash('Entrando na partida…');
    this.render();
    try {
      const joined = await joinMatch(this.o.serverUrl, this.api.token!, { roomId });
      const saved: SavedSession = { serverUrl: this.o.serverUrl, token: this.api.token!, username: this.me?.account.username ?? '' };
      this.enterMatch(joined, saved);
    } catch (err) {
      this.joining = false;
      this.flash(`Não foi possível entrar: ${err instanceof Error ? err.message : String(err)}`, 'error');
      this.render();
    }
  }

  private enterMatch(joined: Joined, saved: SavedSession) {
    this.stopPoll();
    this.preview?.dispose();
    this.preview = null;
    rememberRoom(saved, joined.room, ROOM_KEY);
    this.box.remove();
    document.body.dataset.flow = 'match';
    const match = new NetworkMatch(catalog, joined.room, joined.snapshot);
    // Fase 7: telemetria da partida (atritos de interface/câmera, tempo por turno, saída).
    const playtest = !!this.cfg?.playtest;
    const botSeat = match.seatList.find((s) => s.bot);
    const mode = botSeat ? 'bot' : 'pvp';
    const tracker = new MatchTracker(match.matchId);
    tracker.attach(this.o.canvas);
    let started = false;
    let ended = false;
    let leaving = false;
    const onState = () => {
      const s = match.state;
      tracker.onState(s.turn.turnId, s.status === 'active', s.status === 'active' && match.canControl(s.turn.activeUnitId));
      if (s.status === 'active' && !started) {
        started = true;
        telemetry.track('match_start', { mode, ...(botSeat?.bot ? { difficulty: botSeat.bot } : {}), resumed: match.version > 1 }, match.matchId);
      }
      if (s.status === 'finished' && !ended) {
        ended = true;
        telemetry.track('match_end', { mode, outcome: outcomeOf(s, match.team), rounds: s.turn.round }, match.matchId);
        tracker.finish(false);
        if (mode === 'pvp') this.watchRematch(match.matchId, backToLobby);
      }
    };
    match.onChange(onState);
    const leftActive = (reason: string) => {
      if (match.state.status !== 'active') return;
      telemetry.track('match_leave', { reason }, match.matchId);
      tracker.finish(true);
    };
    window.addEventListener('pagehide', () => {
      if (!leaving) leftActive('pagehide');
    });
    const backToLobby = () => {
      leaving = true;
      leftActive('lobby_button');
      telemetry.flush();
      this.stopRematch();
      saveSession(null, ROOM_KEY);
      void joined.room.leave().finally(() => {
        const params = new URLSearchParams(location.search);
        location.search = params.toString();
      });
    };
    onState();
    /** Pesquisa (uma vez por partida) antes de sair da tela de resultado. */
    const afterSurvey = (next: () => void) => () => void this.maybeSurvey(match, mode === 'bot').then(next);
    const rematch = afterSurvey(() => void this.requestRematch(match.matchId, mode, backToLobby));
    const bug = () => void this.reportBug(match.matchId);
    // Fase 6: partida cancelada antes de começar (o adversário não entrou no prazo) — volta ao
    // lobby, onde o servidor já devolveu este jogador à fila.
    joined.room.onLeave((code: number) => {
      if (code !== 4100) return;
      saveSession(null, ROOM_KEY);
      location.search = new URLSearchParams(location.search).toString();
    });
    const screen = startArenaScreen(this.o.canvas, this.o.hudRoot, catalog, patioDasRuinas, {
      match,
      leave: backToLobby,
      telemetry: tracker,
      ...(playtest ? { reportBug: bug } : {}),
      game: {
        endActions: [
          { id: 'rewards', label: 'Ver recompensas', run: () => this.showRewards(match, { back: afterSurvey(backToLobby), rematch, bug: playtest ? bug : null }) },
          { id: 'rematch', label: 'Revanche', run: rematch },
          { id: 'lobby', label: 'Voltar ao lobby', secondary: true, run: afterSurvey(backToLobby) },
          ...(playtest ? [{ id: 'bug', label: 'Reportar bug', secondary: true, run: bug }] : []),
        ],
        endSubtitle: (state: GameState) => {
          const r = state.result;
          if (!r) return null;
          if (r.kind === 'draw') return 'Empate.';
          return r.winnerTeam === match.team ? 'Você venceu!' : r.reason === 'surrender' ? 'Você desistiu.' : 'Você perdeu.';
        },
      },
    });
    this.o.onArena(screen, match);
  }

  /** Tela de recompensas (depois do resultado): calculada pelo servidor; volta ao lobby. */
  // -------------------------------------------------------------------------
  // Fase 7: pesquisa e revanche
  // -------------------------------------------------------------------------

  private surveyed(): Set<string> {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(SURVEY_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }

  /** Pesquisa curta (teste externo), uma vez por partida terminada. */
  private async maybeSurvey(match: NetworkMatch, vsBot: boolean): Promise<void> {
    if (!this.cfg?.playtest || match.state.status !== 'finished') return;
    const done = this.surveyed();
    if (done.has(match.matchId)) return;
    done.add(match.matchId);
    sessionStorage.setItem(SURVEY_KEY, JSON.stringify([...done].slice(-50)));
    telemetry.track('survey_open', {}, match.matchId);
    const outcome = outcomeOf(match.state, match.team);
    const r = await showSurvey(this.o.hudRoot, {
      matchId: match.matchId,
      vsBot,
      outcomeLabel: OUTCOME_LABEL[outcome] ?? outcome,
      submit: async (input) => void (await this.api.submitSurvey(input)),
    });
    telemetry.track(r === 'sent' ? 'survey_submit' : 'survey_skip', {}, match.matchId);
  }

  /**
   * "Revanche": contra o bot a partida nova nasce na hora; no PvP vira um pedido ao adversário
   * (quando os dois pedem, ou ele aceita, a partida nasce). Entrar = recarregar a página, que
   * encontra a partida montada no lobby (mesmo caminho de "Voltar ao lobby").
   */
  private async requestRematch(matchId: string, mode: string, go: () => void): Promise<void> {
    telemetry.track('rematch_click', { mode }, matchId);
    try {
      const r = await this.api.rematch(matchId);
      if (r.status === 'created') return go();
      this.showRematchBox(`Revanche pedida — aguardando <b>${esc(r.opponent)}</b>… <button type="button" class="link" data-rematch-cancel="${r.inviteId}">cancelar</button>`);
      this.watchRematch(matchId, go);
    } catch (err) {
      this.showRematchBox(`<span class="bad">${esc(err instanceof Error ? err.message : String(err))}</span>`);
    }
  }

  private showRematchBox(html: string | null) {
    if (!html) {
      this.rematchBox?.remove();
      this.rematchBox = null;
      return;
    }
    if (!this.rematchBox) {
      this.rematchBox = document.createElement('div');
      this.rematchBox.className = 'hud-panel flow-rematch';
      this.rematchBox.dataset.rematch = '1';
      this.o.hudRoot.append(this.rematchBox);
      this.rematchBox.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (!b) return;
        if (b.dataset.rematchAccept) void this.api.acceptInvite(b.dataset.rematchAccept).then(() => this.rematchGo?.(), (err: unknown) => this.showRematchBox(esc(String((err as Error).message ?? err))));
        if (b.dataset.rematchDecline) void this.api.declineInvite(b.dataset.rematchDecline).then(() => this.showRematchBox(null));
        if (b.dataset.rematchCancel) void this.api.cancelInvite(b.dataset.rematchCancel).then(() => this.showRematchBox('Pedido de revanche cancelado.'));
      });
    }
    if (this.rematchBox.innerHTML !== html) this.rematchBox.innerHTML = html;
  }

  private rematchGo: (() => void) | null = null;

  /** PvP: acompanha pedidos de revanche (do adversário ou o nosso) e entra quando a partida nasce. */
  private watchRematch(matchId: string, go: () => void) {
    this.rematchGo = go;
    if (this.rematchTimer) return;
    this.rematchTimer = setInterval(async () => {
      const st = await this.api.lobbyStatus().catch(() => null);
      if (!st) return;
      if (st.match) {
        this.stopRematch();
        return go();
      }
      const inc = st.invites.incoming.find((i) => i.rematchOf === matchId && i.status === 'pending');
      const out = st.invites.outgoing.find((i) => i.rematchOf === matchId);
      if (inc) this.showRematchBox(`<b>${esc(inc.from.displayName)}</b> quer revanche! <button type="button" class="hud-button" data-rematch-accept="${inc.id}">Aceitar revanche</button> <button type="button" class="link" data-rematch-decline="${inc.id}">recusar</button>`);
      else if (out?.status === 'pending') this.showRematchBox(`Revanche pedida — aguardando <b>${esc(out.to.displayName)}</b>… <button type="button" class="link" data-rematch-cancel="${out.id}">cancelar</button>`);
      else if (out && out.status !== 'accepted') this.showRematchBox(`${esc(out.to.displayName)} não aceitou a revanche.`);
    }, 1000);
  }

  private stopRematch() {
    if (this.rematchTimer) clearInterval(this.rematchTimer);
    this.rematchTimer = null;
  }

  private showRewards(match: NetworkMatch, act: { back: () => void; rematch: () => void; bug: (() => void) | null }) {
    const back = act.back;
    const overlay = document.createElement('div');
    overlay.className = 'hud-lobby flow';
    this.o.hudRoot.append(overlay);
    document.body.dataset.flow = 'rewards';
    const draw = (r: MatchRewardDto | null) => {
      const body = r
        ? `<div class="end-kicker">Recompensas</div>
           <div class="flow-title outcome-${r.outcome}" data-outcome="${r.outcome}">${OUTCOME_LABEL[r.outcome]}</div>
           <div class="flow-reward-coins" data-reward-coins="${r.coins}">+${r.coins} moedas <span class="sub">(${esc(MODE_LABEL[r.mode] ?? r.mode)}${r.stats.surrendered ? ', desistência' : ''})</span></div>
           ${r.missionCoins ? `<div class="flow-reward-coins small">+${r.missionCoins} moedas de missões</div>` : ''}
           <div class="sub">Saldo: <b data-balance="${r.balance}">${r.balance}</b> moedas · dano causado ${r.stats.damageDealt} · barris detonados ${r.stats.barrelsDetonated}</div>
           <div class="flow-h">Missões</div>
           ${
             r.missions.length
               ? r.missions
                   .map(
                     (m) => `<div class="flow-mission${m.completedNow ? ' done' : ''}" data-reward-mission="${m.id}" data-after="${m.after}">
                       <div><b>${esc(m.name)}</b> <span class="sub">${m.before} → ${m.after} / ${m.target}</span>${m.completedNow ? ` <span class="flow-new">concluída! ${esc([m.reward.coins ? `+${m.reward.coins} moedas` : '', m.reward.cosmeticName ?? ''].filter(Boolean).join(' + '))}</span>` : ''}</div>
                       <div class="flow-bar"><i style="width:${Math.round((100 * m.after) / m.target)}%"></i></div></div>`,
                   )
                   .join('')
               : '<div class="sub">Nenhuma missão avançou nesta partida.</div>'
           }
           ${r.unlocked.length ? `<div class="flow-new" data-unlocked>Desbloqueado: ${r.unlocked.map((id) => esc(cosmeticsById[id]?.name ?? id)).join(', ')}</div>` : ''}`
        : '<div class="flow-title">Recompensas</div><div class="sub" data-reward-wait>Calculando recompensas no servidor…</div>';
      overlay.innerHTML = `<div class="hud-panel flow-box flow-rewards" data-screen="rewards">${body}<div class="flow-actions"><button type="button" class="hud-button" data-act="rematch">Revanche</button><button type="button" class="hud-button" data-act="back-lobby">Voltar ao lobby</button></div>${act.bug ? '<div class="flow-foot sub"><button type="button" class="link" data-act="bug">reportar bug</button></div>' : ''}</div>`;
    };
    draw(match.rewards);
    overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="back-lobby"]')) back();
      if ((e.target as HTMLElement).closest('[data-act="rematch"]')) act.rematch();
      if ((e.target as HTMLElement).closest('[data-act="bug"]')) act.bug?.();
    });
    const off = match.onRewards((r) => draw(r));
    // Sem a mensagem (ex.: recarregou no fim): pergunta ao servidor.
    const timer = setInterval(() => {
      if (match.rewards) {
        clearInterval(timer);
        off();
        return;
      }
      void this.api.reward(match.matchId).then(
        (r) => {
          match.rewards = r;
          draw(r);
        },
        () => undefined,
      );
    }, 1500);
  }
}

/** Resultado do ponto de vista da equipe (victory / defeat / draw). */
function outcomeOf(state: GameState, team: string): string {
  const r = state.result;
  if (!r) return 'unknown';
  return r.kind === 'victory' ? (r.winnerTeam === team ? 'victory' : 'defeat') : 'draw';
}

function toggleConsumable(list: string[], id: string): string[] {
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-MAX_START_CONSUMABLES);
  return normalizeChoice(catalog, { classId: 'warrior', consumables: next }, 'warrior').consumables ?? [];
}

export { ROOM_KEY };
