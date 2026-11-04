/**
 * Fase 5: cliente da API HTTP do ciclo de jogo (conta, personagem, loja, missões, histórico,
 * lobby). Sem DOM: usado pela interface e pelos testes em Node. A sessão (token) fica em
 * `localStorage` no navegador (`bardurinho.conta`) para sobreviver a recarregar a página.
 */
import type {
  BuyResponse,
  CharacterDto,
  CharacterInput,
  HistoryEntryDto,
  InviteDto,
  LobbyStatusDto,
  LoginResponse,
  MatchRewardDto,
  MeResponse,
  MissionDto,
  PlaytestConfigDto,
  RematchResponse,
  ShopItemDto,
  SurveyInput,
  BugReportInput,
} from '@bardurinho/protocol';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class GameApi {
  constructor(
    readonly serverUrl: string,
    public token: string | null = null,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new ApiError('Servidor indisponível — ele está rodando (npm run server)?', 0);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok && !(path === '/shop/buy' && res.status === 409)) throw new ApiError(data.error ?? `Erro ${res.status}`, res.status);
    return data;
  }

  async register(username: string, password: string, displayName?: string, inviteCode?: string): Promise<LoginResponse> {
    const r = await this.call<LoginResponse>('POST', '/auth/register', { username, password, ...(displayName ? { displayName } : {}), ...(inviteCode ? { inviteCode } : {}) });
    this.token = r.token;
    return r;
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const r = await this.call<LoginResponse>('POST', '/auth/login', { username, password });
    this.token = r.token;
    return r;
  }

  async logout(): Promise<void> {
    await this.call('POST', '/auth/logout').catch(() => undefined);
    this.token = null;
  }

  me = () => this.call<MeResponse>('GET', '/me');
  createCharacter = (c: CharacterInput) => this.call<CharacterDto>('POST', '/characters', c);
  updateCharacter = (id: string, patch: Partial<Omit<CharacterInput, 'name' | 'classId'>>) => this.call<CharacterDto>('PATCH', `/characters/${encodeURIComponent(id)}`, patch);
  selectCharacter = (id: string) => this.call<MeResponse>('POST', `/characters/${encodeURIComponent(id)}/select`);
  shop = () => this.call<ShopItemDto[]>('GET', '/shop');
  buy = (productId: string, requestId: string) => this.call<BuyResponse>('POST', '/shop/buy', { productId, requestId });
  missions = () => this.call<MissionDto[]>('GET', '/missions');
  history = () => this.call<HistoryEntryDto[]>('GET', '/matches/history');
  reward = (matchId: string) => this.call<MatchRewardDto>('GET', `/matches/${encodeURIComponent(matchId)}/reward`);
  lobbyStatus = () => this.call<LobbyStatusDto>('GET', '/lobby/status');
  playBot = (difficulty: string) => this.call<{ roomId: string }>('POST', '/lobby/bot', { difficulty });
  joinQueue = () => this.call<LobbyStatusDto>('POST', '/lobby/queue');
  leaveQueue = () => this.call<LobbyStatusDto>('DELETE', '/lobby/queue');
  invite = (to: string) => this.call<InviteDto>('POST', '/lobby/invites', { to });
  acceptInvite = (id: string) => this.call<{ roomId: string }>('POST', `/lobby/invites/${encodeURIComponent(id)}/accept`);
  declineInvite = (id: string) => this.call<LobbyStatusDto>('POST', `/lobby/invites/${encodeURIComponent(id)}/decline`);
  cancelInvite = (id: string) => this.call<LobbyStatusDto>('POST', `/lobby/invites/${encodeURIComponent(id)}/cancel`);
  // Fase 7: teste externo
  playtestConfig = () => this.call<PlaytestConfigDto>('GET', '/playtest/config');
  rematch = (matchId: string) => this.call<RematchResponse>('POST', '/lobby/rematch', { matchId });
  submitSurvey = (s: SurveyInput) => this.call<{ ok: boolean; duplicate: boolean }>('POST', '/feedback/survey', s);
  reportBug = (b: BugReportInput) => this.call<{ ok: boolean; id: string; attached: boolean }>('POST', '/feedback/bug', b);
  setConsent = (consent: boolean) => this.call<{ ok: boolean }>('POST', '/telemetry/consent', { consent });
}

// ---------------------------------------------------------------------------
// Sessão da conta no navegador
// ---------------------------------------------------------------------------

export interface StoredAccount {
  serverUrl: string;
  token: string;
  username: string;
  expiresAt?: number;
}

const ACCOUNT_KEY = 'bardurinho.conta';
const local = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadAccount(): StoredAccount | null {
  try {
    const raw = local()?.getItem(ACCOUNT_KEY);
    const s = raw ? (JSON.parse(raw) as StoredAccount) : null;
    if (s?.expiresAt && s.expiresAt < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveAccount(s: StoredAccount | null): void {
  if (!s) local()?.removeItem(ACCOUNT_KEY);
  else local()?.setItem(ACCOUNT_KEY, JSON.stringify(s));
}

/** Identificador de solicitação (compras idempotentes). */
export const newRequestId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
