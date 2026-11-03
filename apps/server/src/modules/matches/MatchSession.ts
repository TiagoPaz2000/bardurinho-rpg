/**
 * Partida autoritativa no servidor (seções 11.2–11.5), independente do Colyseus: estado
 * oficial, fila de processamento, validação, persistência, projeção por equipe e cronômetro.
 * O adaptador `adapters/colyseus/MatchRoom.ts` liga conexões a assentos e repassa mensagens.
 *
 * Processamento de um comando (um por vez por partida, numa fila):
 *  1. identificar (assento autenticado)   2. validar formato (`parseClientCommand`)
 *  3. repetição (`commandId` já visto → devolve a mesma resposta, sem reaplicar)
 *  4. autorizar (o personagem é da equipe do assento)   5–9. `applyCommand` do core, sem
 *     opções de debug (turno, recursos, alcance, andar, linha de visão, consequências)
 * 10. persistir comando + eventos + snapshot (transação)   11. confirmar (vira oficial)
 * 12. projetar e enviar a visão de cada equipe (`projectStateForClient` / `projectEventsForTeam`)
 */
import { randomUUID } from 'node:crypto';
import {
  applyCommand,
  buildScenario,
  type Catalog,
  type GameEvent,
  type GameplayCommand,
  type GameState,
  projectEventsForTeam,
  projectStateForClient,
  type ScenarioInitial,
} from '@bardurinho/domain';
import {
  parseClientCommand,
  stateHash,
  stripEnvelope,
  type CommandResultMessage,
  type SeatInfo,
  type ServerError,
  type ServerMessages,
  type SnapshotMessage,
  type TurnTimer,
  type UpdateMessage,
} from '@bardurinho/protocol';
import type { Account, MatchesRepository } from '../../db/repositories.js';

export interface SeatState {
  seat: number;
  team: string;
  account: Account | null;
  connected: boolean;
  /** Último envio (versão + hash da projeção) e a confirmação do cliente (`ack`). */
  sent: { version: number; hash: string } | null;
  ack: { version: number; hash: string } | null;
  /** Hashes enviados por versão (recentes), para conferir os `ack`. */
  sentHashes: Map<number, string>;
  divergences: Array<{ version: number; expected: string; got: string }>;
  /** Eventos projetados desde o início (snapshot de reconexão leva o histórico). */
  history: GameEvent[];
}

export type Author = { kind: 'player'; seat: number } | { kind: 'timer' } | { kind: 'server' };

export interface MatchSessionOptions {
  id?: string;
  roomId: string;
  mapId: string;
  scenario: ScenarioInitial;
  catalog: Catalog;
  repo: MatchesRepository;
  seed: number;
  turnSeconds: number;
  /** Envio para um assento (o adaptador decide a conexão). */
  send: <K extends keyof ServerMessages>(seat: number, type: K, message: ServerMessages[K]) => void;
  log?: (msg: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { clear(): void };
}

const RECENT_HASHES = 64;

export class MatchSession {
  readonly id: string;
  readonly seats: SeatState[];
  private official: GameState;
  private ver = 0;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** commandId → (assento autor, resposta) — proteção contra repetição. */
  private readonly responses = new Map<string, { seat: number | null; response: CommandResultMessage }>();
  private timer: { turnId: number; deadline: number; handle: { clear(): void } } | null = null;
  private disposed = false;
  readonly ready: Promise<void>;

  constructor(private readonly o: MatchSessionOptions) {
    this.id = o.id ?? randomUUID();
    this.official = buildScenario(o.catalog, { ...o.scenario, dice: 'random', seed: o.seed, autoStart: false });
    const teams = [...new Set(Object.values(this.official.units).filter((u) => !u.flags.isDummy).map((u) => u.team))].sort();
    this.seats = teams.map((team, seat) => ({ seat, team, account: null, connected: false, sent: null, ack: null, sentHashes: new Map(), divergences: [], history: [] }));
    this.ready = o.repo.create({ id: this.id, roomId: o.roomId, mapId: o.mapId, state: this.official, seed: o.seed, turnSeconds: o.turnSeconds, hash: stateHash(this.official) });
    // Nada é processado antes de a partida existir no banco.
    this.queue = this.ready.catch(() => undefined);
  }

  get state(): GameState {
    return this.official;
  }
  get version(): number {
    return this.ver;
  }
  get turnSeconds(): number {
    return this.o.turnSeconds;
  }
  get seed(): number {
    return this.o.seed;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  seatOf(accountId: string): SeatState | undefined {
    return this.seats.find((s) => s.account?.id === accountId);
  }

  /** Assento do jogador: o que já é dele ou o próximo livre. */
  async claimSeat(account: Account): Promise<SeatState | null> {
    await this.ready;
    const own = this.seatOf(account.id);
    if (own) return own;
    const free = this.seats.find((s) => !s.account);
    if (!free) return null;
    free.account = account;
    await this.o.repo.addPlayer(this.id, free.seat, free.team, account.id);
    return free;
  }

  get full(): boolean {
    return this.seats.every((s) => s.account);
  }

  seatInfo(): SeatInfo[] {
    return this.seats.map((s) => ({ seat: s.seat, team: s.team, username: s.account?.username ?? null, displayName: s.account?.displayName ?? null, connected: s.connected }));
  }

  timerInfo(): TurnTimer | null {
    if (!this.timer || this.official.status !== 'active') return null;
    return { turnId: this.timer.turnId, deadline: this.timer.deadline, turnSeconds: this.o.turnSeconds, serverNow: this.now() };
  }

  /** Projeção da equipe (estado enviado + hash). */
  projection(team: string): { state: GameState; hash: string; hiddenUnits: string[] } {
    const p = projectStateForClient(this.official, this.o.catalog, team);
    const hiddenUnits = Object.keys(this.official.units).filter((id) => !p.state.units[id]);
    return { state: p.state, hash: stateHash(p.state), hiddenUnits };
  }

  /** Snapshot autorizado para um assento (entrada, reconexão, ressincronização). */
  snapshot(seat: number, reason: SnapshotMessage['reason'], roomId: string): SnapshotMessage {
    const s = this.seats[seat]!;
    const p = this.projection(s.team);
    this.recordSent(s, this.ver, p.hash);
    return { matchId: this.id, roomId, version: this.ver, team: s.team, seat, state: p.state, hash: p.hash, timer: this.timerInfo(), seats: this.seatInfo(), history: [...s.history], reason };
  }

  private recordSent(s: SeatState, version: number, hash: string) {
    s.sent = { version, hash };
    s.sentHashes.set(version, hash);
    if (s.sentHashes.size > RECENT_HASHES) s.sentHashes.delete(s.sentHashes.keys().next().value!);
  }

  /** Confirmação do cliente: compara o hash do que ele tem com o que foi enviado. */
  ack(seat: number, version: unknown, hash: unknown): boolean | null {
    const s = this.seats[seat];
    if (!s || typeof version !== 'number' || typeof hash !== 'string') return null;
    s.ack = { version, hash };
    const expected = s.sentHashes.get(version);
    if (expected === undefined) return null;
    if (expected !== hash) {
      s.divergences.push({ version, expected, got: hash });
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] DIVERGÊNCIA no assento ${seat} (v${version}): esperado ${expected}, cliente ${hash}`);
      return false;
    }
    return true;
  }

  /** Coloca o trabalho na fila da partida (um comando por vez). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Inicia a partida (os dois assentos ocupados): START_MATCH é do servidor. */
  start(): Promise<CommandResultMessage> {
    return this.enqueue(() => this.process({ type: 'START_MATCH' }, `server:start:${this.id}`, { kind: 'server' }, { type: 'START_MATCH' }));
  }

  /** Comando vindo de um jogador (mensagem crua da rede). */
  submit(seat: number, raw: unknown): Promise<CommandResultMessage> {
    return this.enqueue(async () => {
      const parsed = parseClientCommand(raw);
      if (!parsed.ok) {
        const commandId = parsed.commandId ?? '';
        if (parsed.commandId && this.responses.has(parsed.commandId)) return this.duplicate(seat, parsed.commandId);
        return this.rejectNow(seat, commandId, parsed.error, raw);
      }
      const cmd = parsed.command;
      if (this.responses.has(cmd.commandId)) return this.duplicate(seat, cmd.commandId);
      const s = this.seats[seat];
      if (!s?.account) return this.rejectNow(seat, cmd.commandId, { code: 'NOT_A_PLAYER', message: 'Assento sem jogador' }, raw);
      const actorId = 'actorId' in cmd ? cmd.actorId : undefined;
      const actor = actorId ? this.official.units[actorId] : undefined;
      if (actor && actor.team !== s.team) return this.rejectNow(seat, cmd.commandId, { code: 'NOT_YOUR_UNIT', message: `O personagem ${actorId} não é da sua equipe` }, raw);
      return this.process(stripEnvelope(cmd), cmd.commandId, { kind: 'player', seat }, raw);
    });
  }

  private duplicate(seat: number, commandId: string): CommandResultMessage {
    const prev = this.responses.get(commandId)!;
    // Repetição de um commandId de outro jogador: não revela a resposta dele.
    if (prev.seat !== seat) return { commandId, ok: false, duplicate: true, error: { code: 'DUPLICATE_COMMAND', message: 'commandId já utilizado' } };
    return { ...prev.response, duplicate: true };
  }

  private async rejectNow(seat: number | null, commandId: string, error: ServerError, raw: unknown): Promise<CommandResultMessage> {
    const response: CommandResultMessage = { commandId, ok: false, error, duplicate: false };
    if (!commandId) return response;
    this.responses.set(commandId, { seat, response });
    const payload = JSON.stringify(raw ?? null).length <= 4096 ? raw : { truncated: true };
    await this.o.repo
      .saveRejected(this.id, {
        seq: ++this.seq,
        commandId,
        authorKind: seat === null ? 'server' : 'player',
        accountId: seat === null ? null : (this.seats[seat]?.account?.id ?? null),
        seat,
        turnId: this.official.turn.turnId,
        payload: payload ?? null,
        error,
      })
      .catch((err) => this.o.log?.(`falha ao registrar comando recusado: ${String(err)}`));
    return response;
  }

  private async process(command: GameplayCommand, commandId: string, author: Author, raw: unknown): Promise<CommandResultMessage> {
    if (this.disposed) return { commandId, ok: false, duplicate: false, error: { code: 'MATCH_NOT_ACTIVE', message: 'Partida encerrada' } };
    const seat = author.kind === 'player' ? author.seat : null;
    const before = this.official;
    const r = applyCommand(before, this.o.catalog, command, {});
    if (!r.ok) return this.rejectNow(seat, commandId, r.error, raw);
    const version = this.ver + 1;
    const hash = stateHash(r.state);
    try {
      await this.o.repo.saveAccepted(
        this.id,
        { seq: ++this.seq, commandId, authorKind: author.kind, accountId: seat === null ? null : (this.seats[seat]?.account?.id ?? null), seat, turnId: before.turn.turnId, payload: command, versionAfter: version },
        r.events,
        r.state,
        hash,
      );
    } catch (err) {
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] falha ao persistir: ${String(err)}`);
      return { commandId, ok: false, duplicate: false, error: { code: 'PERSISTENCE_ERROR', message: 'Falha ao salvar o comando; nada foi aplicado' } };
    }
    // Confirmado: o estado candidato vira oficial.
    this.official = r.state;
    this.ver = version;
    const response: CommandResultMessage = { commandId, ok: true, version, duplicate: false };
    this.responses.set(commandId, { seat, response });
    this.rescheduleTimer(before);
    this.broadcastUpdate(before, r.events, command, commandId, author);
    if (this.official.status === 'finished') this.o.log?.(`[partida ${this.id.slice(0, 8)}] fim: ${JSON.stringify(this.official.result)} (v${version})`);
    return response;
  }

  private broadcastUpdate(before: GameState, events: readonly GameEvent[], command: GameplayCommand, commandId: string, author: Author) {
    const timer = this.timerInfo();
    for (const s of this.seats) {
      const p = this.projection(s.team);
      const evs = projectEventsForTeam(events, before, this.official, this.o.catalog, s.team);
      s.history.push(...evs);
      this.recordSent(s, this.ver, p.hash);
      const msg: UpdateMessage = {
        version: this.ver,
        commandId: author.kind === 'player' && author.seat === s.seat ? commandId : null,
        author: { seat: author.kind === 'player' ? author.seat : null, kind: author.kind },
        commandType: command.type,
        events: evs,
        state: p.state,
        hash: p.hash,
        timer,
      };
      this.o.send(s.seat, 'update', msg);
    }
  }

  // -------------------------------------------------------------------------
  // Cronômetro do turno (seção 11.5: continua com o jogador desconectado; turno esgotado
  // é encerrado pelo servidor).
  // -------------------------------------------------------------------------

  private rescheduleTimer(before: GameState) {
    const s = this.official;
    if (s.status !== 'active') {
      this.timer?.handle.clear();
      this.timer = null;
      return;
    }
    if (this.timer && before.turn.turnId === s.turn.turnId && before.status === 'active') return;
    this.timer?.handle.clear();
    const turnId = s.turn.turnId;
    const ms = Math.max(0, this.o.turnSeconds * 1000);
    const setTimer = this.o.setTimer ?? ((fn, t) => {
      const h = setTimeout(fn, t);
      return { clear: () => clearTimeout(h) };
    });
    this.timer = { turnId, deadline: this.now() + ms, handle: setTimer(() => void this.expireTurn(turnId), ms) };
  }

  /** Turno esgotado: o servidor envia END_TURN pelo personagem da vez. */
  expireTurn(turnId: number): Promise<CommandResultMessage | null> {
    return this.enqueue(async () => {
      const s = this.official;
      if (this.disposed || s.status !== 'active' || s.turn.turnId !== turnId || !s.turn.activeUnitId) return null;
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] tempo esgotado no turno ${turnId}: END_TURN automático`);
      const command: GameplayCommand = { type: 'END_TURN', actorId: s.turn.activeUnitId, expectedTurnId: turnId };
      return this.process(command, `timer:${this.id}:${turnId}`, { kind: 'timer' }, command);
    });
  }

  /** Espera a fila esvaziar (testes). */
  idle(): Promise<void> {
    return this.enqueue(async () => undefined);
  }

  dispose() {
    this.disposed = true;
    this.timer?.handle.clear();
    this.timer = null;
  }
}
