/**
 * Fase 7 — teste externo do MVP: contrato das rotas do playtest (configuração pública,
 * telemetria do cliente, pesquisa pós-partida, relatório de bug, revanche) e a validação dos
 * eventos de telemetria (compartilhada por cliente e servidor).
 *
 *   GET  /playtest/config            → PlaytestConfigDto (público)
 *   POST /telemetry/events           TelemetryBatch (só com consentimento; token opcional)
 *   POST /telemetry/consent          { consent: boolean } (autenticada) — registra a decisão
 *   POST /feedback/survey            SurveyInput → { ok, duplicate }
 *   POST /feedback/bug               BugReportInput → { ok, id, attached }
 *   POST /lobby/rematch              { matchId } → RematchResponse
 *   /admin/*                         painel e API de métricas (ADMIN_TOKEN)
 */

export interface BuildInfo {
  /** Versão do pacote raiz (ex.: 0.7.0). */
  version: string;
  /** Commit curto (ou "local"). */
  commit: string;
  /** ISO 8601. */
  builtAt: string;
}

export const formatBuild = (b: BuildInfo): string => `v${b.version} · ${b.commit}`;

export interface PlaytestConfigDto {
  /** Teste externo ligado: tela de consentimento, telemetria, pesquisa e "reportar bug". */
  playtest: boolean;
  /** Cadastro: aberto, só com código de convite, ou fechado. */
  registration: 'open' | 'invite' | 'closed';
  /** Versão do servidor. */
  build: BuildInfo;
  /** Versão do conteúdo/regras (para os relatórios). */
  contentVersion: string;
}

// ---------------------------------------------------------------------------
// Telemetria do cliente
// ---------------------------------------------------------------------------

export const TELEMETRY_EVENT_TYPES = [
  'session_start',
  'heartbeat',
  'page_hide',
  'screen_view',
  'consent',
  'match_start',
  'match_end',
  'match_ui',
  'match_leave',
  'rematch_click',
  'survey_open',
  'survey_submit',
  'survey_skip',
  'bug_report_open',
  'bug_report_submit',
  'client_error',
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export type TelemetryProps = Record<string, number | boolean | string>;

export interface TelemetryEvent {
  type: TelemetryEventType;
  /** Relógio do cliente (ms desde 1970). */
  t: number;
  matchId?: string;
  props?: TelemetryProps;
}

export interface TelemetryBatch {
  /** O cliente só envia com consentimento (o servidor recusa sem). */
  consent: true;
  /** Id aleatório do navegador (gerado só depois do consentimento). */
  clientId: string;
  /** Id da sessão (aba). */
  sessionId: string;
  build: string;
  events: TelemetryEvent[];
}

export const TELEMETRY_MAX_EVENTS = 50;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const MATCH_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TYPES = new Set<string>(TELEMETRY_EVENT_TYPES);

/** Só números finitos, booleanos e textos curtos; no máximo 24 chaves. */
export function sanitizeProps(value: unknown): TelemetryProps {
  const out: TelemetryProps = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (n >= 24 || !KEY_RE.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
    else continue;
    n++;
  }
  return out;
}

export type ParsedBatch = { ok: true; batch: TelemetryBatch } | { ok: false; error: string };

/** Valida um lote de eventos; eventos de tipo desconhecido são descartados (não derrubam o lote). */
export function parseTelemetryBatch(value: unknown, now = Date.now()): ParsedBatch {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Lote inválido' };
  const v = value as Record<string, unknown>;
  if (v.consent !== true) return { ok: false, error: 'Sem consentimento' };
  if (typeof v.clientId !== 'string' || !ID_RE.test(v.clientId)) return { ok: false, error: 'clientId inválido' };
  if (typeof v.sessionId !== 'string' || !ID_RE.test(v.sessionId)) return { ok: false, error: 'sessionId inválido' };
  if (!Array.isArray(v.events) || v.events.length === 0 || v.events.length > TELEMETRY_MAX_EVENTS) return { ok: false, error: 'events inválido' };
  const events: TelemetryEvent[] = [];
  for (const raw of v.events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.type !== 'string' || !TYPES.has(e.type)) continue;
    // Relógio do cliente fora de ±2 dias vira o do servidor.
    const t = typeof e.t === 'number' && Number.isFinite(e.t) && Math.abs(e.t - now) < 2 * 86400_000 ? e.t : now;
    const ev: TelemetryEvent = { type: e.type as TelemetryEventType, t, props: sanitizeProps(e.props) };
    if (typeof e.matchId === 'string' && MATCH_RE.test(e.matchId)) ev.matchId = e.matchId;
    events.push(ev);
  }
  if (!events.length) return { ok: false, error: 'Nenhum evento válido' };
  const build = typeof v.build === 'string' ? v.build.slice(0, 64) : '';
  return { ok: true, batch: { consent: true, clientId: v.clientId, sessionId: v.sessionId, build, events } };
}

// ---------------------------------------------------------------------------
// Pesquisa pós-partida e bug
// ---------------------------------------------------------------------------

/** Equilíbrio percebido: −2 (muito contra mim) … 0 (equilibrada) … +2 (muito a meu favor). */
export const BALANCE_LABELS: Record<string, string> = { '-2': 'Muito contra mim', '-1': 'Um pouco contra mim', '0': 'Equilibrada', '1': 'Um pouco a meu favor', '2': 'Muito a meu favor' };
/** Dificuldade do bot: 1 (muito fácil) … 3 (na medida) … 5 (muito difícil). */
export const BOT_RATING_LABELS: Record<string, string> = { '1': 'Muito fácil', '2': 'Fácil', '3': 'Na medida', '4': 'Difícil', '5': 'Muito difícil' };
export const PLAY_AGAIN = ['sim', 'talvez', 'nao'] as const;
export const BUG_CATEGORIES = ['interface', 'camera', 'regras', 'conexao', 'desempenho', 'bot', 'outro'] as const;

export interface SurveyInput {
  matchId: string;
  /** 1–5 (obrigatório). */
  fun: number;
  /** "Entendi o que estava acontecendo" 1–5. */
  clarity?: number | null;
  /** "A câmera ajudou" 1–5. */
  camera?: number | null;
  /** −2…+2. */
  balance?: number | null;
  /** Só contra bot: 1–5. */
  botRating?: number | null;
  playAgain?: (typeof PLAY_AGAIN)[number] | null;
  comment?: string;
  build?: string;
}

export interface BugReportInput {
  matchId?: string | null;
  category: (typeof BUG_CATEGORIES)[number];
  description: string;
  client?: TelemetryProps;
  build?: string;
}

export type RematchResponse =
  /** Partida criada (bot, ou o adversário já tinha pedido): entrar com `joinById`. */
  | { status: 'created'; roomId: string }
  /** PvP: pedido enviado; espera o adversário (convite com `rematchOf`). */
  | { status: 'waiting'; inviteId: string; opponent: string };
