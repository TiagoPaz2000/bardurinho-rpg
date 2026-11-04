/**
 * Fase 7: telemetria leve do cliente para o teste externo — **só com consentimento** e só para
 * o nosso servidor de jogo (`POST /telemetry/events`).
 *
 * O que vai: tipo do evento, horário, id aleatório do navegador (`clientId`, criado só depois de
 * aceitar), id da sessão (aba), versão do build e números/textos curtos (tela vista, contagens
 * de cancelamentos/recusas/uso da câmera, tempo por turno, cliques em revanche). O que não vai:
 * usuário, senha, nome, IP (o servidor não grava), conteúdo digitado, posição do mouse.
 *
 * Sem consentimento (ou com o teste externo desligado no servidor) nada é guardado nem enviado.
 */
import type { TelemetryEvent, TelemetryEventType, TelemetryProps } from '@bardurinho/protocol';
import { BUILD_LABEL } from '../build.js';

const CONSENT_KEY = 'bardurinho.privacidade.v1';
const CLIENT_KEY = 'bardurinho.telemetria.cliente';
const SESSION_KEY = 'bardurinho.telemetria.sessao';
const FLUSH_MS = 10_000;
const HEARTBEAT_MS = 60_000;
const MAX_ERRORS = 5;

export type Consent = 'yes' | 'no' | null;

const store = (kind: 'local' | 'session'): Storage | null => {
  try {
    return kind === 'local' ? (typeof localStorage !== 'undefined' ? localStorage : null) : typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
};

const randomId = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && 'randomUUID' in c) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

export class Telemetry {
  private queue: TelemetryEvent[] = [];
  private serverUrl = '';
  private token: string | null = null;
  private enabled = false;
  private started = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private errors = 0;
  /** Último envio (testes/e2e). */
  sent = 0;

  /** Servidor e se o teste externo está ligado nele (`/playtest/config`). */
  configure(serverUrl: string, playtestOn: boolean): void {
    this.serverUrl = serverUrl;
    this.enabled = playtestOn;
    if (this.active) this.startSession();
  }

  get consent(): Consent {
    try {
      const raw = store('local')?.getItem(CONSENT_KEY);
      const v = raw ? (JSON.parse(raw) as { value?: string }).value : null;
      return v === 'yes' || v === 'no' ? v : null;
    } catch {
      return null;
    }
  }

  /** Decisão da tela de privacidade. Recusar apaga o id do navegador e a fila. */
  setConsent(value: 'yes' | 'no'): void {
    store('local')?.setItem(CONSENT_KEY, JSON.stringify({ value, at: new Date().toISOString(), version: 1 }));
    if (value === 'no') {
      this.queue = [];
      store('local')?.removeItem(CLIENT_KEY);
      store('session')?.removeItem(SESSION_KEY);
      this.stop();
      return;
    }
    if (this.enabled) {
      this.startSession();
      this.track('consent', { value: true });
    }
  }

  get active(): boolean {
    return this.enabled && this.consent === 'yes';
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  track(type: TelemetryEventType, props?: TelemetryProps, matchId?: string): void {
    if (!this.active) return;
    this.queue.push({ type, t: Date.now(), ...(props ? { props } : {}), ...(matchId ? { matchId } : {}) });
    if (this.queue.length >= 25) this.flush();
  }

  private clientId(): string {
    const s = store('local');
    let id = s?.getItem(CLIENT_KEY) ?? '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = randomId();
      s?.setItem(CLIENT_KEY, id);
    }
    return id;
  }

  /** Sessão = aba (sobrevive a recarregar a página, que o jogo faz ao voltar ao lobby). */
  private sessionId(): { id: string; fresh: boolean } {
    const s = store('session');
    const id = s?.getItem(SESSION_KEY) ?? '';
    if (/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { id, fresh: false };
    const fresh = randomId();
    s?.setItem(SESSION_KEY, fresh);
    return { id: fresh, fresh: true };
  }

  private startSession(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    const { fresh } = this.sessionId();
    if (fresh) this.track('session_start', { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1, touch: 'ontouchstart' in window });
    let lastBeat = Date.now();
    this.flushTimer = setInterval(() => {
      if (Date.now() - lastBeat >= HEARTBEAT_MS && document.visibilityState === 'visible') {
        lastBeat = Date.now();
        this.track('heartbeat');
      }
      this.flush();
    }, FLUSH_MS);
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  private stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.started = false;
    if (typeof window === 'undefined') return;
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  private readonly onHide = () => {
    this.track('page_hide');
    this.flush(true);
  };
  private readonly onError = (e: ErrorEvent) => this.error(e.message);
  private readonly onRejection = (e: PromiseRejectionEvent) => this.error(String((e.reason as Error)?.message ?? e.reason));

  private error(message: string) {
    if (this.errors++ >= MAX_ERRORS) return;
    this.track('client_error', { message: String(message ?? '').slice(0, 64) });
  }

  /** Envia a fila (lotes de até 50). `beacon` = página saindo (sendBeacon, sem cabeçalhos). */
  flush(beacon = false): void {
    if (!this.active || !this.queue.length || !this.serverUrl) return;
    while (this.queue.length) {
      const events = this.queue.splice(0, 50);
      const body = JSON.stringify({ consent: true, clientId: this.clientId(), sessionId: this.sessionId().id, build: BUILD_LABEL, events });
      const url = `${this.serverUrl}/telemetry/events`;
      this.sent += events.length;
      if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        // text/plain: "pedido simples" (sem preflight de CORS no modo de desenvolvimento).
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
        continue;
      }
      void fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body }).catch(() => undefined);
    }
  }
}

export const telemetry = new Telemetry();

// ---------------------------------------------------------------------------
// Por partida: atritos de interface/câmera e tempo por turno (resumo único no fim)
// ---------------------------------------------------------------------------

const CAMERA_KEYS: Record<string, string> = {
  KeyQ: 'cameraRotate',
  KeyE: 'cameraRotate',
  KeyW: 'cameraPan',
  KeyA: 'cameraPan',
  KeyS: 'cameraPan',
  KeyD: 'cameraPan',
  ArrowUp: 'cameraPan',
  ArrowDown: 'cameraPan',
  ArrowLeft: 'cameraPan',
  ArrowRight: 'cameraPan',
  KeyF: 'cameraFocus',
};

export class MatchTracker {
  readonly counts: Record<string, number> = {};
  private readonly turnSeconds: number[] = [];
  private myTurn: { turnId: number; since: number } | null = null;
  private sent = false;
  private lastWheel = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    readonly matchId: string,
    private readonly t: Telemetry = telemetry,
  ) {}

  count(name: string): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  /** Câmera: roda (um gesto a cada 400 ms), arrastos (botão do meio/direito) e teclas. */
  attach(canvas: HTMLCanvasElement): void {
    const wheel = () => {
      const now = Date.now();
      if (now - this.lastWheel > 400) this.count('cameraZoom');
      this.lastWheel = now;
    };
    const down = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) this.count('cameraDrag');
    };
    const key = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      const k = CAMERA_KEYS[e.code];
      if (k) this.count(k);
    };
    canvas.addEventListener('wheel', wheel, { passive: true });
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    this.cleanup.push(
      () => canvas.removeEventListener('wheel', wheel),
      () => canvas.removeEventListener('pointerdown', down),
      () => window.removeEventListener('keydown', key, true),
    );
  }

  /** A cada mudança de estado: mede o tempo de cada turno do jogador (início → fim da vez). */
  onState(turnId: number, active: boolean, mine: boolean, now = Date.now()): void {
    if (this.myTurn && (this.myTurn.turnId !== turnId || !active)) {
      this.turnSeconds.push((now - this.myTurn.since) / 1000);
      this.myTurn = null;
    }
    if (active && mine && !this.myTurn) this.myTurn = { turnId, since: now };
  }

  summary(partial: boolean): TelemetryProps {
    const n = this.turnSeconds.length;
    const avg = n ? this.turnSeconds.reduce((a, b) => a + b, 0) / n : 0;
    return { ...this.counts, turns: n, turnAvgS: Math.round(avg * 10) / 10, turnMaxS: n ? Math.round(Math.max(...this.turnSeconds) * 10) / 10 : 0, partial };
  }

  /** Resumo da partida (uma vez). `partial` = saiu antes do fim. */
  finish(partial: boolean): void {
    if (this.sent) return;
    this.sent = true;
    this.t.track('match_ui', this.summary(partial), this.matchId);
    for (const c of this.cleanup) c();
    if (partial) this.t.flush(true);
  }
}
