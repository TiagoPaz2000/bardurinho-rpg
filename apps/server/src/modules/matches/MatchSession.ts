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
  computeTeamVision,
  unitAt,
  type Catalog,
  type CommandTarget,
  type GameEvent,
  type GameplayCommand,
  type GameState,
  projectEventsForTeam,
  projectStateForClient,
  type ScenarioInitial,
  type TeamVision,
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
import { metrics, now as perfNow } from '../../metrics.js';
import { normalizeTeam, scenarioFromSetup, type CharacterChoice, type MapDefinition, type TeamId } from '@bardurinho/content';

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
  /** Fase 5: personagem do assento (nome + cosméticos) e bot que o controla. */
  character: { id: string | null; name: string; classId: string; appearance: Record<string, string> } | null;
  bot: string | null;
}

/** Fase 5: assento reservado pelo servidor (fila, convite ou bot) com o personagem da conta. */
export interface ReservedSeat {
  seat: number;
  account: Account;
  choice: CharacterChoice;
  character: { id: string | null; name: string; classId: string; appearance: Record<string, string> } | null;
  /** Dificuldade quando o assento é de um bot (fica sempre "conectado"). */
  bot?: string;
}

export type Author = { kind: 'player'; seat: number } | { kind: 'timer' } | { kind: 'server' };

export interface MatchSessionOptions {
  id?: string;
  roomId: string;
  mapId: string;
  scenario: ScenarioInitial;
  /**
   * Fase 4: escolha de personagens. Com `teamSize` (1 ou 2) a partida é montada a partir do
   * mapa (`setupMap`) com a escolha de cada assento (`claimSeat(conta, escolha)`); sem ele, o
   * cenário fixo (`scenario`) é usado como na Fase 3.
   */
  teamSize?: number;
  setupMap?: MapDefinition;
  catalog: Catalog;
  repo: MatchesRepository;
  /** Fase 5: modo da partida (pvp, private, bot, custom) e dificuldade do bot. */
  mode?: string;
  botDifficulty?: string | null;
  /** Fase 5: assentos reservados (só estas contas entram); exige `teamSize` + `setupMap`. */
  reserved?: ReservedSeat[];
  /** Fase 5: chamado uma vez quando a partida termina (recompensas). */
  onFinished?: () => void;
  seed: number;
  turnSeconds: number;
  /** Envio para um assento (o adaptador decide a conexão). */
  send: <K extends keyof ServerMessages>(seat: number, type: K, message: ServerMessages[K]) => void;
  log?: (msg: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { clear(): void };
}

const RECENT_HASHES = 64;
/** Fase 6: recusas lembradas (repetição) e gravadas (auditoria) por partida. */
const MAX_REMEMBERED_REJECTIONS = 2000;
const MAX_LOGGED_REJECTIONS = 5000;

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
  private readonly rejectedIds: string[] = [];
  private rejectedLogged = 0;
  readonly ready: Promise<void>;
  /** Escolha de personagens por assento (Fase 4). */
  private readonly loadouts = new Map<number, CharacterChoice[]>();

  constructor(private readonly o: MatchSessionOptions) {
    this.id = o.id ?? randomUUID();
    for (const r of o.reserved ?? []) this.loadouts.set(r.seat, [r.choice]);
    this.official = buildScenario(o.catalog, { ...this.initialScenario(), dice: 'random', seed: o.seed, autoStart: false });
    const teams = [...new Set(Object.values(this.official.units).filter((u) => !u.flags.isDummy).map((u) => u.team))].sort();
    this.seats = teams.map((team, seat) => ({ seat, team, account: null, connected: false, sent: null, ack: null, sentHashes: new Map(), divergences: [], history: [], character: null, bot: null }));
    const created = o.repo.create({ id: this.id, roomId: o.roomId, mapId: o.mapId, state: this.official, seed: o.seed, turnSeconds: o.turnSeconds, hash: stateHash(this.official), mode: o.mode ?? 'custom', botDifficulty: o.botDifficulty ?? null });
    // Bots ocupam o assento desde o início (sempre "conectados").
    for (const r of o.reserved ?? []) {
      const seat = this.seats[r.seat];
      if (!seat) continue;
      seat.character = r.character;
      if (r.bot) {
        seat.account = r.account;
        seat.bot = r.bot;
        seat.connected = true;
      }
    }
    this.ready = created.then(async () => {
      for (const r of o.reserved ?? []) if (r.bot) await o.repo.addPlayer(this.id, r.seat, this.seats[r.seat]!.team, r.account.id, r.character ? { id: r.character.id, snapshot: r.character } : null);
    });
    // Nada é processado antes de a partida existir no banco.
    this.queue = this.ready.catch(() => undefined);
  }

  get state(): GameState {
    return this.official;
  }

  get teamSize(): number | null {
    return this.o.teamSize ?? null;
  }

  /** Cenário inicial: fixo (Fase 3) ou montado com a escolha de cada assento (Fase 4). */
  private initialScenario(): ScenarioInitial {
    const size = this.o.teamSize;
    if (!size || !this.o.setupMap) return this.o.scenario;
    const team = (t: TeamId, seat: number) => normalizeTeam(this.o.catalog, t, this.loadouts.get(seat) ?? [], size);
    return scenarioFromSetup(this.o.setupMap, this.o.catalog, { teams: { A: team('A', 0), B: team('B', 1) } }, { ids: 'opaque' });
  }

  /** Escolha do assento (antes do início): remonta o estado inicial e o snapshot 0. */
  private async configureSeat(seat: SeatState, choice: unknown): Promise<void> {
    if (!this.o.teamSize || !this.o.setupMap || this.ver !== 0 || this.official.status !== 'setup') return;
    if (!Array.isArray(choice) || choice.length === 0) return;
    this.loadouts.set(seat.seat, normalizeTeam(this.o.catalog, seat.team as TeamId, choice, this.o.teamSize));
    this.official = buildScenario(this.o.catalog, { ...this.initialScenario(), dice: 'random', seed: this.o.seed, autoStart: false });
    await this.o.repo.replaceInitialSnapshot(this.id, this.official, stateHash(this.official));
  }

  /** Personagens escolhidos por assento (lista de salas / lobby). */
  loadoutOf(seat: number): CharacterChoice[] | null {
    return this.loadouts.get(seat) ?? null;
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
  async claimSeat(account: Account, choice?: unknown): Promise<SeatState | null> {
    await this.ready;
    const own = this.seatOf(account.id);
    if (own) return own;
    // Fase 5: partida montada pelo servidor — só a conta reservada entra no seu assento.
    const reserved = this.o.reserved?.find((r) => r.account.id === account.id && !r.bot);
    if (this.o.reserved && !reserved) return null;
    const free = reserved ? this.seats[reserved.seat] : this.seats.find((s) => !s.account);
    if (!free || free.account) return null;
    free.account = account;
    await this.o.repo.addPlayer(this.id, free.seat, free.team, account.id, free.character ? { id: free.character.id, snapshot: free.character } : null);
    if (reserved) return free;
    // Na fila da partida: nada é processado enquanto a montagem muda.
    await this.enqueue(() => this.configureSeat(free, choice));
    return free;
  }

  get full(): boolean {
    return this.seats.every((s) => s.account);
  }

  get mode(): string {
    return this.o.mode ?? 'custom';
  }

  /** Fase 6: contas humanas com assento reservado (partida montada pelo servidor). */
  get reservedAccounts(): Account[] | null {
    return this.o.reserved ? this.o.reserved.filter((r) => !r.bot).map((r) => r.account) : null;
  }

  /** A conta pode entrar nesta partida (assento já dela, reservado para ela, ou vaga livre sem reserva). */
  canJoin(accountId: string): boolean {
    if (this.seatOf(accountId)) return true;
    if (this.o.reserved) return this.o.reserved.some((r) => r.account.id === accountId && !r.bot);
    return !this.full;
  }

  seatInfo(): SeatInfo[] {
    return this.seats.map((s) => ({
      seat: s.seat,
      team: s.team,
      username: s.account?.username ?? null,
      displayName: s.account?.displayName ?? null,
      connected: s.connected,
      ...(s.character ? { character: { name: s.character.name, appearance: s.character.appearance } } : {}),
      ...(s.bot ? { bot: s.bot } : {}),
    }));
  }

  timerInfo(): TurnTimer | null {
    if (!this.timer || this.official.status !== 'active') return null;
    return { turnId: this.timer.turnId, deadline: this.timer.deadline, turnSeconds: this.o.turnSeconds, serverNow: this.now() };
  }

  /**
   * Projeção da equipe (estado enviado + hash). Fase 6: guardada por equipe para o estado oficial
   * atual — o envio, o bot, o snapshot e o próximo comando (visão "antes") reaproveitam a visão,
   * a cópia e o hash em vez de recalcular (era o maior custo por comando no teste de carga).
   */
  projection(team: string): { state: GameState; hash: string; hiddenUnits: string[] } {
    const p = this.projected(team);
    return { state: p.state, hash: p.hash, hiddenUnits: p.hiddenUnits };
  }

  private readonly projections = new Map<string, { of: GameState; state: GameState; hash: string; hiddenUnits: string[]; vision: TeamVision }>();

  private projected(team: string) {
    const cached = this.projections.get(team);
    if (cached && cached.of === this.official) return cached;
    const vision = computeTeamVision(this.official, this.o.catalog, team);
    const p = projectStateForClient(this.official, this.o.catalog, team, vision);
    const entry = { of: this.official, state: p.state, hash: stateHash(p.state), hiddenUnits: Object.keys(this.official.units).filter((id) => !p.state.units[id]), vision };
    this.projections.set(team, entry);
    return entry;
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
    metrics.inc('desync.acks');
    if (expected !== hash) {
      s.divergences.push({ version, expected, got: hash });
      metrics.inc('desync.divergences');
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
      const hidden = this.hiddenTargetError(s.team, cmd);
      if (hidden) return this.rejectNow(seat, cmd.commandId, hidden, raw);
      return this.process(stripEnvelope(cmd), cmd.commandId, { kind: 'player', seat }, raw);
    });
  }

  /**
   * Fase 6: alvo que a equipe não vê. Um personagem inimigo oculto como alvo (`entity`, ou a
   * célula dele numa habilidade de alvo "personagem") é recusado com o **mesmo erro** de um alvo
   * inexistente — senão as respostas do core (fora de alcance, sem linha de visão, outro andar)
   * revelariam onde ele está. Atacar uma célula às cegas continua valendo (regra do jogo).
   */
  private hiddenTargetError(team: string, cmd: { type: string; target?: CommandTarget; abilityId?: string; itemId?: string }): ServerError | null {
    const target = cmd.target;
    if (!target || target.kind === 'self') return null;
    const official = this.official;
    let vision: ReturnType<typeof computeTeamVision> | null = null;
    const hidden = (id: string | undefined) => {
      const u = id ? official.units[id] : undefined;
      if (!u || u.team === team || !u.alive) return false;
      vision ??= computeTeamVision(official, this.o.catalog, team);
      return !vision.visibleUnits.has(u.id);
    };
    if (target.kind === 'entity') return hidden(target.id) ? { code: 'INVALID_TARGET', message: `Entidade desconhecida: ${target.id}` } : null;
    const rule = cmd.type === 'USE_ABILITY' ? this.o.catalog.abilities[cmd.abilityId ?? '']?.target : cmd.type === 'USE_ITEM' ? (this.o.catalog.items[cmd.itemId ?? ''] as { target?: { kind: string } } | undefined)?.target : undefined;
    if (rule?.kind !== 'unit') return null;
    const u = unitAt(official, { x: target.x, y: target.y, floor: target.floor });
    return u && hidden(u.id) ? { code: 'INVALID_TARGET', message: 'O alvo precisa ser um personagem vivo' } : null;
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
    // Fase 6: memória e banco limitados contra um cliente que só manda lixo (o limite de
    // mensagens por segundo da sala segura a taxa; isto segura o total).
    this.rejectedIds.push(commandId);
    if (this.rejectedIds.length > MAX_REMEMBERED_REJECTIONS) this.responses.delete(this.rejectedIds.shift()!);
    if (++this.rejectedLogged > MAX_LOGGED_REJECTIONS) {
      metrics.inc('commands.rejectedNotLogged');
      return response;
    }
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
    const t0 = perfNow();
    const r = applyCommand(before, this.o.catalog, command, {});
    const t1 = perfNow();
    metrics.time('core.applyCommand', t1 - t0);
    if (!r.ok) {
      metrics.inc('commands.rejected');
      return this.rejectNow(seat, commandId, r.error, raw);
    }
    const version = this.ver + 1;
    const hash = stateHash(r.state);
    const t2 = perfNow();
    metrics.time('core.stateHash', t2 - t1);
    try {
      await this.o.repo.saveAccepted(
        this.id,
        { seq: ++this.seq, commandId, authorKind: author.kind, accountId: seat === null ? null : (this.seats[seat]?.account?.id ?? null), seat, turnId: before.turn.turnId, payload: command, versionAfter: version },
        r.events,
        r.state,
        hash,
      );
      metrics.time('db.saveAccepted', perfNow() - t2);
    } catch (err) {
      metrics.inc('db.errors');
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] falha ao persistir: ${String(err)}`);
      return { commandId, ok: false, duplicate: false, error: { code: 'PERSISTENCE_ERROR', message: 'Falha ao salvar o comando; nada foi aplicado' } };
    }
    // Confirmado: o estado candidato vira oficial.
    this.official = r.state;
    this.ver = version;
    const response: CommandResultMessage = { commandId, ok: true, version, duplicate: false };
    this.responses.set(commandId, { seat, response });
    this.rescheduleTimer(before);
    const t3 = perfNow();
    this.broadcastUpdate(before, r.events, command, commandId, author);
    const t4 = perfNow();
    metrics.time('net.projectAndSend', t4 - t3);
    metrics.time('command.total', t4 - t0);
    metrics.inc('commands.accepted');
    if (this.official.status === 'finished') {
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] fim: ${JSON.stringify(this.official.result)} (v${version})`);
      // Recompensas depois da resposta (fora da fila da partida).
      if (this.o.onFinished) setTimeout(() => this.o.onFinished?.(), 0);
    }
    return response;
  }

  private broadcastUpdate(before: GameState, events: readonly GameEvent[], command: GameplayCommand, commandId: string, author: Author) {
    const timer = this.timerInfo();
    // Visão "antes" de cada equipe = a do estado anterior, ainda no cache (antes de recalcular).
    const beforeVision = new Map<string, TeamVision>();
    for (const [team, c] of this.projections) if (c.of === before) beforeVision.set(team, c.vision);
    for (const s of this.seats) {
      const p = this.projected(s.team);
      const evs = projectEventsForTeam(events, before, this.official, this.o.catalog, s.team, { before: beforeVision.get(s.team), after: p.vision });
      // Fase 6: numeração própria da equipe — as lacunas do `seq` oficial contavam quantos
      // eventos ocultos (ex.: passos do inimigo fora da visão) aconteceram.
      evs.forEach((e, i) => (e.seq = s.history.length + i + 1));
      s.history.push(...evs);
      this.recordSent(s, this.ver, p.hash);
      // Comando de outra equipe cujo autor ela não conhece (não há COMMAND_ACCEPTED na visão): o
      // tipo também fica oculto (ex.: "USE_ABILITY" de um inimigo fora da visão).
      const ownSeat = author.kind === 'player' && author.seat === s.seat;
      const hiddenType = author.kind === 'player' && !ownSeat && !evs.some((e) => e.type === 'COMMAND_ACCEPTED');
      const msg: UpdateMessage = {
        version: this.ver,
        commandId: ownSeat ? commandId : null,
        author: { seat: author.kind === 'player' ? author.seat : null, kind: author.kind },
        commandType: hiddenType ? 'HIDDEN' : command.type,
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

  /**
   * Fase 6: abandono confirmado (a reserva da vaga acabou) — o servidor rende a equipe do
   * assento. Vale fora da vez (SURRENDER é aceito a qualquer momento).
   */
  forfeit(seat: number): Promise<CommandResultMessage | null> {
    return this.enqueue(async () => {
      const s = this.official;
      const team = this.seats[seat]?.team;
      if (this.disposed || s.status !== 'active' || !team) return null;
      const unit = Object.values(s.units).find((u) => u.team === team && u.alive && !u.flags.isDummy);
      if (!unit) return null;
      this.o.log?.(`[partida ${this.id.slice(0, 8)}] assento ${seat} abandonou (reserva esgotada): derrota`);
      const command: GameplayCommand = { type: 'SURRENDER', actorId: unit.id };
      return this.process(command, `server:forfeit:${this.id}:${seat}`, { kind: 'server' }, command);
    });
  }

  /** Fase 6: encerra sem resultado (cancelada antes do início / sala abandonada). */
  async abort(status: 'cancelled' | 'aborted'): Promise<void> {
    await this.idle();
    if (this.official.status === 'finished') return;
    this.dispose();
    await this.o.repo.abort(this.id, status).catch((err) => this.o.log?.(`falha ao encerrar a partida: ${String(err)}`));
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
