/**
 * Sala Colyseus de uma partida (adaptador; as regras ficam em MatchSession + domínio).
 *
 * - Entrada: `joinOrCreate('arena', { token })`. O token da sessão (POST /auth/login) é
 *   conferido em `onAuth`; o assento fica preso à conta (A = primeira conta, B = segunda).
 * - Com os dois assentos ocupados a sala vira privada (sai do matchmaking) e o servidor
 *   envia START_MATCH. Quem tem assento pode voltar por `joinById(roomId, { token })`.
 * - Queda: `allowReconnection(client, RECONNECT_SECONDS)` (reserva de vaga, seção 11.5); ao
 *   voltar, o cliente recebe um snapshot novo. O cronômetro continua correndo.
 * - Sem estado sincronizado do Colyseus: cada cliente recebe só mensagens com a visão da sua
 *   equipe (`snapshot`, `update`), montadas no servidor.
 */
import { Room, type Client } from '@colyseus/core';
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import type { BotDifficultyId, MatchMode } from '@bardurinho/content';
import { MATCH_ROOM, type ServerMessages } from '@bardurinho/protocol';
import type { Account } from '../../db/repositories.js';
import { BotSeat } from '../../modules/bots/BotSeat.js';
import { MatchSession, type ReservedSeat } from '../../modules/matches/MatchSession.js';
import type { ServerServices } from '../../services.js';

interface JoinOptions {
  token?: string;
  /** Só com `dev`: semente dos dados e duração do turno escolhidas ao criar a sala. */
  seed?: number;
  turnSeconds?: number;
  /**
   * Fase 4: formato escolhido por quem cria a sala (1 = 1 × 1, 2 = 2 × 2; o matchmaking só
   * junta salas do mesmo formato — `filterBy(['teamSize'])`) e a escolha de personagens do
   * jogador (classe, acessório, consumíveis), validada no servidor (`normalizeTeam`).
   */
  teamSize?: number;
  team?: unknown;
  /**
   * Fase 5: partida montada pelo servidor (fila, convite, bot). Só vale com a chave interna
   * (`services.internalKey`) — um cliente não consegue criar sala com assentos reservados.
   */
  internal?: string;
  mode?: MatchMode;
  reserved?: ReservedSeat[];
  botDifficulty?: BotDifficultyId;
}

interface ClientAuth {
  account: Account;
}

export class MatchRoom extends Room {
  static services: ServerServices;
  session!: MatchSession;
  /** Conexão atual de cada assento. */
  private readonly seatClients = new Map<number, Client>();
  private abandonTimer: ReturnType<typeof setTimeout> | null = null;
  private starting = false;
  /** Fase 5: bot que ocupa um assento (partida contra bot). */
  private bot: BotSeat | null = null;
  private settled = false;

  override maxClients = 4;

  /**
   * Limite de mensagens por conexão (proteção contra flood). Não usa `maxMessagesPerSecond` do
   * Colyseus: ele conta pelo relógio da sala, que só anda com `setSimulationInterval` — sem
   * simulação o contador nunca zera e a conexão cai depois de N mensagens no total.
   */
  private readonly rate = new Map<string, { windowStart: number; count: number }>();
  static readonly MAX_MESSAGES_PER_SECOND = 120;

  private allow(client: Client): boolean {
    const now = Date.now();
    const r = this.rate.get(client.sessionId) ?? { windowStart: now, count: 0 };
    if (now - r.windowStart >= 1000) {
      r.windowStart = now;
      r.count = 0;
    }
    r.count++;
    this.rate.set(client.sessionId, r);
    if (r.count <= MatchRoom.MAX_MESSAGES_PER_SECOND) return true;
    this.svc.log(`[sala ${this.roomId}] ${client.sessionId}: mensagens demais por segundo; desconectado`);
    client.leave(4002);
    return false;
  }

  private get svc(): ServerServices {
    return MatchRoom.services;
  }

  override async onCreate(options: JoinOptions = {}) {
    const svc = this.svc;
    const dev = svc.config.dev;
    const seed = dev && Number.isInteger(options.seed) && options.seed! > 0 ? options.seed! : 1 + Math.floor(Math.random() * (2 ** 31 - 2));
    const turnSeconds = dev && typeof options.turnSeconds === 'number' && options.turnSeconds > 0 ? options.turnSeconds : svc.config.turnSeconds;
    this.autoDispose = false;
    // Fase 5: só o próprio servidor cria partidas com assentos reservados.
    const internal = options.internal === svc.internalKey && Array.isArray(options.reserved);
    const mode: MatchMode = internal && options.mode ? options.mode : 'custom';
    const teamSize = internal ? 1 : options.teamSize === 1 || options.teamSize === 2 ? options.teamSize : undefined;
    const botDifficulty = internal ? (options.botDifficulty ?? null) : null;
    this.session = new MatchSession({
      roomId: this.roomId,
      mapId: svc.map.id,
      scenario: svc.map.scenario,
      ...(teamSize ? { teamSize, setupMap: svc.map } : {}),
      ...(internal ? { reserved: options.reserved!, mode, botDifficulty, onFinished: () => void this.settle() } : {}),
      catalog: svc.catalog,
      repo: svc.matches,
      seed,
      turnSeconds,
      send: (seat, type, message) => this.sendToSeat(seat, type, message),
      log: (m) => svc.log(m),
    });
    await this.session.ready;
    svc.rooms.set(this.session.id, this);
    if (internal) await this.setPrivate(true);
    const botSeat = this.session.seats.find((x) => x.bot);
    if (botSeat && botDifficulty) {
      const brain = new BotBrain(svc.catalog, botSeat.team, { difficulty: botDifficulty, seed, explore: exploreTargets(svc.map, botSeat.team) });
      this.bot = new BotSeat(this.session, botSeat.seat, brain, { delayMs: svc.config.botDelayMs, log: (m) => svc.log(`[sala ${this.roomId}] ${m}`) });
    }
    await this.setMetadata({ matchId: this.session.id, seats: this.session.seatInfo(), status: this.session.state.status, teamSize: this.session.teamSize });
    svc.log(`[sala ${this.roomId}] partida ${this.session.id} criada (semente ${seed}, turno ${turnSeconds} s)`);

    this.onMessage('command', async (client, message) => {
      const seat = this.seatOfClient(client);
      if (seat === null || !this.allow(client)) return;
      const result = await this.session.submit(seat, message);
      client.send('result', result);
    });
    this.onMessage('ack', (client, message: { version?: unknown; hash?: unknown }) => {
      const seat = this.seatOfClient(client);
      if (seat !== null && this.allow(client)) this.session.ack(seat, message?.version, message?.hash);
    });
    this.onMessage('resync', (client) => {
      const seat = this.seatOfClient(client);
      if (seat !== null && this.allow(client)) client.send('snapshot', this.session.snapshot(seat, 'resync', this.roomId));
    });
  }

  override async onAuth(_client: Client, options: JoinOptions = {}): Promise<ClientAuth> {
    const account = await this.svc.accounts.bySession(options.token ?? '');
    if (!account) throw new Error('Sessão inválida: faça login novamente');
    if (!this.session.canJoin(account.id)) throw new Error(this.session.full ? 'Sala cheia' : 'Partida reservada para outros jogadores');
    return { account };
  }

  override async onJoin(client: Client, options: JoinOptions = {}, auth?: ClientAuth) {
    const account = (auth ?? (client.auth as ClientAuth)).account;
    const hadSeat = !!this.session.seatOf(account.id);
    const seat = await this.session.claimSeat(account, options.team);
    if (!seat) throw new Error('Sala cheia');
    // Mesma conta de novo (ex.: recarregou a página sem o token de reconexão): a conexão nova assume.
    const previous = this.seatClients.get(seat.seat);
    if (previous && previous.sessionId !== client.sessionId) previous.leave(4001);
    this.seatClients.set(seat.seat, client);
    seat.connected = true;
    client.userData = { seat: seat.seat };
    this.svc.lobby?.joined(account.id);
    this.cancelAbandon();
    client.send('snapshot', this.session.snapshot(seat.seat, hadSeat ? 'reconnect' : 'join', this.roomId));
    // Fase 4: a montagem mudou com a escolha deste jogador — quem já estava na sala recebe o
    // estado inicial novo (ainda na versão 0, antes do START_MATCH).
    if (!hadSeat && this.session.teamSize) {
      for (const [other, c] of this.seatClients) if (other !== seat.seat && this.session.seats[other]?.connected) c.send('snapshot', this.session.snapshot(other, 'resync', this.roomId));
    }
    this.broadcastPresence();
    this.svc.log(`[sala ${this.roomId}] ${account.username} no assento ${seat.seat} (equipe ${seat.team})`);
    // Os dois assentos ocupados: inicia depois que a entrada terminar (o cliente já recebeu o snapshot).
    if (this.session.full && this.session.state.status === 'setup' && !this.starting) {
      this.starting = true;
      this.clock.setTimeout(() => void this.startMatch(), 50);
    }
  }

  private async startMatch() {
    try {
      await this.setPrivate(true);
      const r = await this.session.start();
      if (!r.ok) this.svc.log(`[sala ${this.roomId}] START_MATCH recusado: ${r.error.message}`);
      await this.updateMeta();
      this.bot?.notify();
    } catch (err) {
      this.svc.log(`[sala ${this.roomId}] falha ao iniciar: ${String(err)}`);
    }
  }

  override async onDrop(client: Client) {
    const seat = this.seatOfClient(client);
    if (seat === null) return;
    this.session.seats[seat]!.connected = false;
    this.broadcastPresence();
    this.svc.log(`[sala ${this.roomId}] assento ${seat} caiu; vaga reservada por ${this.svc.config.reconnectSeconds} s`);
    if (this.session.state.status !== 'finished') {
      this.allowReconnection(client, this.svc.config.reconnectSeconds).catch(() => undefined);
    }
    this.checkAbandon();
  }

  override onReconnect(client: Client) {
    const seat = this.seatOfClient(client);
    if (seat === null) return;
    // Outra conexão da mesma conta assumiu enquanto esta estava fora.
    if (this.seatClients.get(seat)?.sessionId !== client.sessionId) {
      client.leave(4001);
      return;
    }
    this.seatClients.set(seat, client);
    this.session.seats[seat]!.connected = true;
    this.cancelAbandon();
    client.send('snapshot', this.session.snapshot(seat, 'reconnect', this.roomId));
    this.broadcastPresence();
    this.svc.log(`[sala ${this.roomId}] assento ${seat} reconectado`);
  }

  override onLeave(client: Client) {
    const seat = this.seatOfClient(client);
    if (seat === null) return;
    if (this.seatClients.get(seat)?.sessionId === client.sessionId) {
      this.seatClients.delete(seat);
      this.session.seats[seat]!.connected = false;
    }
    this.broadcastPresence();
    this.checkAbandon();
  }

  override onDispose() {
    this.bot?.dispose();
    this.session?.dispose();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    if (this.session) this.svc.rooms.delete(this.session.id);
  }

  private seatOfClient(client: Client): number | null {
    const seat = (client.userData as { seat?: number } | undefined)?.seat;
    return typeof seat === 'number' ? seat : null;
  }

  private sendToSeat<K extends keyof ServerMessages>(seat: number, type: K, message: ServerMessages[K]) {
    if (this.bot && seat === this.bot.seat) {
      // O bot não tem conexão: é avisado e lê a projeção da sua equipe na sessão.
      this.bot.notify();
      if (type === 'update') void this.updateMeta();
      return;
    }
    const client = this.seatClients.get(seat);
    // Desconectado: nada é enfileirado; ao voltar, o snapshot traz tudo.
    if (client && this.session.seats[seat]?.connected) client.send(type, message);
    if (type === 'update') void this.updateMeta();
  }

  private broadcastPresence() {
    const seats = this.session.seatInfo();
    for (const [seat, client] of this.seatClients) if (this.session.seats[seat]?.connected) client.send('presence', { seats });
    void this.updateMeta();
  }

  private async updateMeta() {
    try {
      await this.setMetadata({ matchId: this.session.id, seats: this.session.seatInfo(), status: this.session.state.status, version: this.session.version, teamSize: this.session.teamSize });
    } catch {
      /* sala encerrando */
    }
    if (this.session.state.status === 'finished') this.autoDispose = true;
  }

  /**
   * Fase 5: fim da partida → recompensa de cada jogador calculada pelo servidor a partir do
   * resultado oficial (estado final + eventos persistidos), uma vez por partida e conta.
   */
  private async settle() {
    if (this.settled) return;
    this.settled = true;
    const s = this.session;
    try {
      const humans = s.seats.filter((x) => x.account && !x.bot).map((x) => ({ accountId: x.account!.id, team: x.team, seat: x.seat }));
      const events = await this.svc.matches.events(s.id);
      const rewards = await this.svc.progression.settleMatch(s.id, s.mode as MatchMode, s.state, events, humans);
      for (const h of humans) {
        const r = rewards.get(h.accountId);
        const client = this.seatClients.get(h.seat);
        if (r && client && s.seats[h.seat]?.connected) client.send('rewards', r);
      }
      this.svc.log(`[sala ${this.roomId}] recompensas: ${[...rewards.entries()].map(([, r]) => `${r.outcome} +${r.coins + r.missionCoins}`).join(', ')}`);
    } catch (err) {
      this.settled = false;
      this.svc.log(`[sala ${this.roomId}] falha ao calcular recompensas: ${String(err)}`);
    }
  }

  /** Nenhum jogador conectado por `abandonSeconds`: encerra a sala (a partida fica no banco). */
  private checkAbandon() {
    const anyone = this.session.seats.some((s) => s.connected && !s.bot);
    if (anyone || this.abandonTimer) return;
    if (this.session.state.status === 'finished') {
      this.autoDispose = true;
      return;
    }
    this.abandonTimer = setTimeout(() => {
      this.svc.log(`[sala ${this.roomId}] sem jogadores por ${this.svc.config.abandonSeconds} s: encerrada`);
      void this.disconnect();
    }, this.svc.config.abandonSeconds * 1000);
  }

  private cancelAbandon() {
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
  }
}

export { MATCH_ROOM };
