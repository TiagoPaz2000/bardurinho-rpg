/**
 * Partida em rede (Fase 3): o servidor é a autoridade; este cliente só envia intenções
 * (`command` com `commandId`) e apresenta o que o servidor decidiu.
 *
 * - Estado: sempre a visão da equipe montada no servidor (`snapshot` / `update`). O cliente
 *   não roda `applyCommand` para decidir nada; as funções do core usadas pela interface
 *   (alcance, alvos válidos, prévia) só leem esse estado projetado.
 * - Cada `update` tem `version` (+1 por comando aceito). Lacuna de versão → pede `resync`
 *   (snapshot novo). Depois de aplicar, o cliente confere o hash do estado com o enviado e
 *   devolve `ack { version, hash }`; o servidor registra divergências (Debug Lab NETWORK).
 * - Reconexão: a queda é tratada pelo SDK (reconexão automática com o token); ao voltar,
 *   o servidor manda um snapshot e a cena é reconstruída sem reproduzir eventos antigos
 *   (seção 14.14). Recarregar a página usa o token guardado em `sessionStorage`.
 *
 * Sem Babylon: o mesmo código roda no navegador e no roteiro e2e (Node).
 */
import type { Room } from '@colyseus/sdk';
import type { Catalog, GameEvent, GameplayCommand, GameState, Unit } from '@bardurinho/domain';
import {
  PROTOCOL_VERSION,
  stateHash,
  type ClientCommand,
  type CommandResultMessage,
  type MatchRewardDto,
  type PresenceMessage,
  type SeatInfo,
  type SnapshotMessage,
  type TurnTimer,
  type UpdateMessage,
} from '@bardurinho/protocol';
import type { ExecuteResult, MatchChange, MatchDriver, MatchPresenter } from '../game/MatchController.js';
import { takeEarly } from './early.js';

type Incoming = { kind: 'snapshot'; msg: SnapshotMessage } | { kind: 'update'; msg: UpdateMessage };

export interface NetworkStatus {
  connection: 'online' | 'reconnecting' | 'offline';
  seats: SeatInfo[];
  timer: TurnTimer | null;
  version: number;
  /** Hash do estado local = hash enviado pelo servidor na última versão aplicada. */
  inSync: boolean;
  divergences: number;
}

const COMMAND_TIMEOUT_MS = 15000;

const newCommandId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export class NetworkMatch implements MatchDriver {
  readonly team: string;
  readonly seat: number;
  readonly matchId: string;
  private current: GameState;
  private shown: GameState;
  private events: readonly GameEvent[] = [];
  private log: GameEvent[];
  private ver: number;
  private playing = false;
  private draining = false;
  private readonly inbox: Incoming[] = [];
  private readonly listeners = new Set<(change: MatchChange) => void>();
  private readonly statusListeners = new Set<(s: NetworkStatus) => void>();
  private readonly pending = new Map<string, { resolve: (r: ExecuteResult) => void; version?: number; timer: ReturnType<typeof setTimeout>; envelope?: unknown }>();
  private connection: NetworkStatus['connection'] = 'online';
  private seats: SeatInfo[];
  private timer: TurnTimer | null;
  /** Diferença relógio do servidor − relógio local (ms). */
  private clockOffset = 0;
  private synced = true;
  private divergences = 0;
  private resyncedAt = -1;
  presenter: MatchPresenter | null = null;
  /** Snapshot recebido (reconexão/ressincronização): a tela reconstrói a cena. */
  onSnapshot: ((msg: SnapshotMessage) => void) | null = null;
  /** Fase 5: recompensa calculada pelo servidor ao fim da partida. */
  rewards: MatchRewardDto | null = null;
  private readonly rewardListeners = new Set<(r: MatchRewardDto) => void>();

  constructor(
    readonly catalog: Catalog,
    private room: Room,
    first: SnapshotMessage,
  ) {
    this.team = first.team;
    this.seat = first.seat;
    this.matchId = first.matchId;
    this.current = first.state;
    this.shown = first.state;
    this.log = [...first.history];
    this.ver = first.version;
    this.seats = first.seats;
    this.timer = first.timer;
    this.setClock(first.timer);
    this.checkHash(first.version, first.state, first.hash);
    this.attach(room);
  }

  /** Liga as mensagens de uma sala (a inicial ou a de uma reconexão manual). */
  attach(room: Room): void {
    this.room = room;
    room.onMessage('snapshot', (msg: SnapshotMessage) => this.push({ kind: 'snapshot', msg }));
    room.onMessage('update', (msg: UpdateMessage) => this.push({ kind: 'update', msg }));
    // Fase 6: mensagens que chegaram antes destes ouvintes (entre o snapshot e agora).
    for (const early of takeEarly(room)) this.push(early);
    room.onMessage('result', (msg: CommandResultMessage) => this.onResult(msg));
    room.onMessage('presence', (msg: PresenceMessage) => {
      this.seats = msg.seats;
      this.emitStatus();
    });
    room.onMessage('rewards', (msg: MatchRewardDto) => {
      this.rewards = msg;
      for (const fn of this.rewardListeners) fn(msg);
    });
    room.onDrop(() => {
      this.connection = 'reconnecting';
      this.emitStatus();
    });
    room.onReconnect(() => {
      this.connection = 'online';
      this.emitStatus();
      // Fase 6: comandos sem resposta quando a conexão caiu são reenviados com o mesmo commandId —
      // o servidor não reaplica (devolve a resposta gravada, `duplicate`) e o cliente não fica
      // esperando o tempo-limite de um resultado que se perdeu na queda.
      for (const p of this.pending.values()) if (p.envelope && p.version === undefined) this.room.send('command', p.envelope);
    });
    room.onLeave(() => {
      this.connection = 'offline';
      this.emitStatus();
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Conexão encerrada' } });
        this.pending.delete(id);
      }
    });
  }

  get roomRef(): Room {
    return this.room;
  }
  get state(): GameState {
    return this.current;
  }
  get displayedState(): GameState {
    return this.shown;
  }
  get lastEvents(): readonly GameEvent[] {
    return this.events;
  }
  get history(): readonly GameEvent[] {
    return this.log;
  }
  get busy(): boolean {
    return this.playing;
  }
  get version(): number {
    return this.ver;
  }
  get activeUnit(): Unit | undefined {
    const id = this.current.turn.activeUnitId;
    return id ? this.current.units[id] : undefined;
  }
  get status(): NetworkStatus {
    return { connection: this.connection, seats: this.seats, timer: this.timer, version: this.ver, inSync: this.synced, divergences: this.divergences };
  }
  /** Segundos restantes do turno pelo relógio do servidor (null sem cronômetro). */
  secondsLeft(now = Date.now()): number | null {
    const t = this.timer;
    if (!t || t.turnId !== this.current.turn.turnId || this.current.status !== 'active') return null;
    return Math.max(0, (t.deadline - (now + this.clockOffset)) / 1000);
  }

  canControl(unitId: string | null | undefined): boolean {
    return !!unitId && this.current.units[unitId]?.team === this.team;
  }

  onChange(fn: (change: MatchChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fase 5: chamada quando a recompensa chega (ou já chegou). */
  onRewards(fn: (r: MatchRewardDto) => void): () => void {
    this.rewardListeners.add(fn);
    if (this.rewards) fn(this.rewards);
    return () => this.rewardListeners.delete(fn);
  }

  /** Fase 5: assentos (nome e aparência do personagem de cada equipe). */
  get seatList(): readonly SeatInfo[] {
    return this.seats;
  }

  onStatus(fn: (s: NetworkStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Envia a intenção ao servidor. Resolve quando o resultado oficial chega e foi apresentado. */
  execute(command: GameplayCommand): Promise<ExecuteResult> {
    if (this.playing) return Promise.resolve({ ok: false, error: { code: 'BUSY', message: 'Aguarde a animação terminar' } });
    if (this.connection !== 'online') return Promise.resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Sem conexão com o servidor' } });
    const envelope: ClientCommand = { ...command, protocolVersion: PROTOCOL_VERSION, commandId: newCommandId() };
    return this.sendRaw(envelope);
  }

  /** Envia um comando já com envelope (testes: repetir um commandId, comandos inválidos). */
  sendRaw(envelope: unknown): Promise<ExecuteResult> {
    const commandId = (envelope as { commandId?: string }).commandId ?? '';
    return new Promise<ExecuteResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'O servidor não respondeu' } });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(commandId, { resolve, timer, envelope });
      this.room.send('command', envelope);
    });
  }

  private onResult(msg: CommandResultMessage) {
    const p = this.pending.get(msg.commandId);
    if (!p) return;
    if (!msg.ok) {
      clearTimeout(p.timer);
      this.pending.delete(msg.commandId);
      if (!msg.duplicate) this.presenter?.rejected({ code: msg.error.code as never, message: msg.error.message }, {} as GameplayCommand);
      p.resolve({ ok: false, error: msg.error });
      return;
    }
    // Aceito: resolve quando a versão já foi aplicada (pode ter chegado antes do resultado).
    p.version = msg.version;
    this.settlePending();
  }

  private settlePending() {
    for (const [id, p] of this.pending) {
      if (p.version !== undefined && p.version <= this.ver && !this.playing) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve({ ok: true, events: this.events });
      }
    }
  }

  private push(item: Incoming) {
    this.inbox.push(item);
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.inbox.length) {
        const item = this.inbox.shift()!;
        if (item.kind === 'snapshot') this.applySnapshot(item.msg);
        else await this.applyUpdate(item.msg);
        this.settlePending();
      }
    } finally {
      this.draining = false;
    }
  }

  private applySnapshot(msg: SnapshotMessage) {
    const before = this.current;
    this.current = msg.state;
    this.shown = msg.state;
    this.ver = msg.version;
    this.log = [...msg.history];
    this.events = [];
    this.seats = msg.seats;
    this.timer = msg.timer;
    this.setClock(msg.timer);
    this.checkHash(msg.version, msg.state, msg.hash);
    this.presenter?.sync(msg.state);
    this.onSnapshot?.(msg);
    const change: MatchChange = { command: { type: 'RESYNC' } as unknown as GameplayCommand, events: [], before, state: msg.state };
    for (const fn of this.listeners) fn(change);
    this.emitStatus();
  }

  private async applyUpdate(msg: UpdateMessage) {
    if (msg.version <= this.ver) return; // repetido / anterior ao snapshot
    if (msg.version !== this.ver + 1) {
      // Lacuna: o snapshot novo substitui tudo.
      this.room.send('resync', {});
      return;
    }
    const before = this.current;
    this.current = msg.state;
    this.ver = msg.version;
    this.events = msg.events;
    this.log.push(...msg.events);
    this.timer = msg.timer;
    this.setClock(msg.timer);
    this.playing = true;
    try {
      if (this.presenter) {
        // Inimigo que entra na visão andando: aparece na célula de onde deu o primeiro passo visível.
        const pre = withArrivals(before, msg.state, msg.events);
        if (pre !== before) this.presenter.sync(pre);
        await this.presenter.play(msg.events, pre, msg.state);
      }
    } catch (err) {
      console.error('Falha na animação dos eventos:', err);
    } finally {
      this.playing = false;
    }
    this.shown = msg.state;
    this.presenter?.sync(msg.state);
    this.checkHash(msg.version, msg.state, msg.hash);
    const change: MatchChange = { command: { type: msg.commandType } as unknown as GameplayCommand, events: msg.events, before, state: msg.state };
    for (const fn of this.listeners) fn(change);
    this.emitStatus();
  }

  /** Confere o hash do estado aplicado com o do servidor e confirma (`ack`). */
  private checkHash(version: number, state: GameState, expected: string) {
    const hash = stateHash(state);
    this.synced = hash === expected;
    if (!this.synced) {
      this.divergences++;
      console.error(`[rede] divergência na versão ${version}: local ${hash} ≠ servidor ${expected}`);
    }
    this.room?.send('ack', { version, hash });
    // Fase 6: estado local diferente do oficial → pede um snapshot novo (uma vez por versão).
    if (!this.synced && this.resyncedAt !== version) {
      this.resyncedAt = version;
      this.room?.send('resync', {});
    }
  }

  private setClock(timer: TurnTimer | null) {
    if (timer) this.clockOffset = timer.serverNow - Date.now();
  }

  private emitStatus() {
    const s = this.status;
    for (const fn of this.statusListeners) fn(s);
  }
}

/** `before` com os inimigos que aparecem neste comando já colocados no início do passo visível. */
function withArrivals(before: GameState, after: GameState, events: readonly GameEvent[]): GameState {
  let pre: GameState | null = null;
  for (const [id, u] of Object.entries(after.units)) {
    if (before.units[id]) continue;
    const step = events.find((e) => (e.type === 'UNIT_MOVED' || e.type === 'FORCED_MOVE') && e.payload.unitId === id);
    if (!step) continue;
    pre ??= structuredClone(before);
    pre.units[id] = { ...structuredClone(u), pos: step.payload.from as Unit['pos'] };
  }
  return pre ?? before;
}
