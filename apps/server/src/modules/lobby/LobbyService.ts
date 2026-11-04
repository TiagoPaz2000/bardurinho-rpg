/**
 * Fase 5: lobby do servidor — fila de matchmaking, convites e partidas contra bot.
 *
 * O cliente consulta `GET /lobby/status` (a cada ~1 s) e recebe a partida montada para ele;
 * entra com `joinById(roomId, { token })`. Toda partida do ciclo é **criada pelo servidor**
 * (`matchMaker.createRoom` com a chave interna): assentos reservados para as contas, com o
 * personagem ativo de cada uma (classe, acessório, consumíveis, nome e cosméticos), sala
 * privada (fora do `joinOrCreate`).
 *
 * Estado em memória (fila, convites, partidas pendentes): reiniciar o servidor esvazia a fila
 * — decisão do MVP local (documentada).
 */
import { randomUUID } from 'node:crypto';
import { matchMaker } from '@colyseus/core';
import type { BotDifficultyId } from '@bardurinho/content';
import { MATCH_ROOM, type InviteDto, type LobbyStatusDto, type RematchResponse } from '@bardurinho/protocol';
import type { Account } from '../../db/repositories.js';
import type { ServerServices } from '../../services.js';
import type { ReservedSeat } from '../matches/MatchSession.js';

/** Fila sem consulta por este tempo: o jogador fechou a aba. */
const QUEUE_STALE_MS = 20000;
const INVITE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 2 * 60 * 1000;

interface QueueEntry {
  account: Account;
  since: number;
  lastPoll: number;
}

interface Invite {
  id: string;
  from: Account;
  to: Account;
  createdAt: number;
  status: InviteDto['status'];
  /** Fase 7: pedido de revanche (partida anterior e o modo dela). */
  rematchOf?: string;
  mode?: 'pvp' | 'private';
}

export class LobbyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class LobbyService {
  private readonly queue = new Map<string, QueueEntry>();
  private readonly invites = new Map<string, Invite>();
  private readonly pending = new Map<string, { roomId: string; mode: string; createdAt: number }>();
  private pairing = false;

  constructor(private readonly svc: ServerServices) {}

  private now() {
    return Date.now();
  }

  /** Personagem ativo da conta pronto para a partida (assento reservado). */
  private async seatFor(account: Account, seat: number): Promise<ReservedSeat> {
    const c = await this.svc.profiles.activeCharacter(account.id);
    if (!c) throw new LobbyError('Crie ou escolha um personagem antes de jogar', 409);
    return {
      seat,
      account,
      choice: { classId: c.classId, accessoryId: c.accessoryId, consumables: c.consumables, name: c.name },
      character: { id: c.id, name: c.name, classId: c.classId, appearance: c.appearance },
    };
  }

  /** Partida em andamento em que a conta tem assento (para voltar depois de recarregar). */
  activeRoomOf(accountId: string): { roomId: string; mode: string } | null {
    for (const room of this.svc.rooms.values()) {
      const s = room.session;
      if (s.state.status !== 'finished' && s.seatOf(accountId) && s.mode !== 'custom') return { roomId: room.roomId, mode: s.mode };
    }
    return null;
  }

  private busy(accountId: string): boolean {
    return this.pending.has(accountId) || !!this.activeRoomOf(accountId);
  }

  /** Cria a sala com assentos reservados e avisa cada jogador (status do lobby). */
  async createMatch(mode: 'pvp' | 'private' | 'bot', players: Account[], bot?: BotDifficultyId, opts: { rematchOf?: string } = {}): Promise<string> {
    const reserved: ReservedSeat[] = [];
    for (const [i, a] of players.entries()) reserved.push(await this.seatFor(a, i));
    if (bot) {
      const name = `Bot ${BOT_NAMES[bot]}`;
      const choice = { ...botCharacter(this.svc.rng), name };
      reserved.push({ seat: reserved.length, account: this.svc.botAccounts[bot], choice, character: { id: null, name, classId: choice.classId, appearance: { color: 'color.natural' } }, bot });
    }
    const room = await matchMaker.createRoom(MATCH_ROOM, { internal: this.svc.internalKey, mode, reserved, teamSize: 1, ...(bot ? { botDifficulty: bot } : {}), ...(opts.rematchOf ? { rematchOf: opts.rematchOf } : {}) });
    for (const a of players) {
      this.queue.delete(a.id);
      this.pending.set(a.id, { roomId: room.roomId, mode, createdAt: this.now() });
    }
    this.svc.log(`[lobby] partida ${mode}${bot ? ` (${bot})` : ''}: ${players.map((p) => p.username).join(' × ')}${bot ? ' × bot' : ''}${opts.rematchOf ? ` (revanche de ${opts.rematchOf.slice(0, 8)})` : ''} → sala ${room.roomId}`);
    return room.roomId;
  }

  async playBot(account: Account, difficulty: unknown): Promise<string> {
    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') throw new LobbyError('Dificuldade inválida');
    if (this.busy(account.id)) throw new LobbyError('Você já está numa partida', 409);
    this.queue.delete(account.id);
    return this.createMatch('bot', [account], difficulty);
  }

  // --- Fila ---------------------------------------------------------------------------

  async enqueue(account: Account): Promise<void> {
    if (this.busy(account.id)) throw new LobbyError('Você já está numa partida', 409);
    await this.seatFor(account, 0); // exige personagem
    if (!this.queue.has(account.id)) this.queue.set(account.id, { account, since: this.now(), lastPoll: this.now() });
    await this.pair();
  }

  leaveQueue(accountId: string): void {
    this.queue.delete(accountId);
  }

  /** Junta os dois primeiros da fila (ordem de chegada). */
  private async pair(): Promise<void> {
    if (this.pairing) return;
    this.pairing = true;
    try {
      const cutoff = this.now() - QUEUE_STALE_MS;
      for (const [id, e] of this.queue) if (e.lastPoll < cutoff) this.queue.delete(id);
      while (this.queue.size >= 2) {
        const [a, b] = [...this.queue.values()];
        this.queue.delete(a!.account.id);
        this.queue.delete(b!.account.id);
        try {
          await this.createMatch('pvp', [a!.account, b!.account]);
        } catch (err) {
          this.svc.log(`[lobby] falha ao montar a partida: ${String(err)}`);
        }
      }
    } finally {
      this.pairing = false;
    }
  }

  // --- Convites -----------------------------------------------------------------------

  async invite(from: Account, to: unknown): Promise<InviteDto> {
    if (typeof to !== 'string' || !to.trim() || to.length > 40) throw new LobbyError('Informe o usuário ou o código de amigo');
    const target = await this.svc.accounts.findPlayer(to);
    if (!target) throw new LobbyError('Jogador não encontrado', 404);
    if (target.id === from.id) throw new LobbyError('Você não pode convidar a si mesmo');
    await this.seatFor(from, 0);
    for (const inv of this.invites.values()) {
      if (inv.status === 'pending' && inv.from.id === from.id && inv.to.id === target.id) return this.dto(inv);
    }
    const inv: Invite = { id: randomUUID(), from, to: target, createdAt: this.now(), status: 'pending' };
    this.invites.set(inv.id, inv);
    this.svc.log(`[lobby] convite ${from.username} → ${target.username}`);
    return this.dto(inv);
  }

  async accept(account: Account, inviteId: string): Promise<string> {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.to.id !== account.id || inv.status !== 'pending') throw new LobbyError('Convite não encontrado', 404);
    if (this.busy(account.id) || this.busy(inv.from.id)) throw new LobbyError('Um dos jogadores já está numa partida', 409);
    inv.status = 'accepted';
    try {
      return await this.createMatch(inv.mode ?? 'private', [inv.from, account], undefined, inv.rematchOf ? { rematchOf: inv.rematchOf } : {});
    } catch (err) {
      inv.status = 'pending';
      throw err;
    }
  }

  respond(account: Account, inviteId: string, action: 'decline' | 'cancel'): void {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.status !== 'pending') throw new LobbyError('Convite não encontrado', 404);
    if (action === 'decline' && inv.to.id !== account.id) throw new LobbyError('Convite não encontrado', 404);
    if (action === 'cancel' && inv.from.id !== account.id) throw new LobbyError('Convite não encontrado', 404);
    inv.status = action === 'decline' ? 'declined' : 'cancelled';
  }

  private dto(i: Invite): InviteDto {
    return { id: i.id, from: { username: i.from.username, displayName: i.from.displayName }, to: { username: i.to.username, displayName: i.to.displayName }, createdAt: i.createdAt, status: i.status, ...(i.rematchOf ? { rematchOf: i.rematchOf } : {}) };
  }

  // --- Revanche (Fase 7) ----------------------------------------------------------------

  /**
   * "Revanche" depois de uma partida terminada. Contra o bot: partida nova na mesma dificuldade.
   * PvP/convite: vira um convite ao adversário marcado com `rematchOf`; se ele já tinha pedido,
   * o pedido dele é aceito e a partida nasce na hora (mesmo modo da anterior). A partida nova
   * guarda `matches.rematch_of` (taxa de revanche).
   */
  async rematch(account: Account, matchId: unknown): Promise<RematchResponse> {
    if (typeof matchId !== 'string' || !matchId || matchId.length > 64) throw new LobbyError('Partida inválida');
    const m = await this.svc.matches.get(matchId);
    const players = m ? await this.svc.matches.players(matchId) : [];
    if (!m || !players.some((p) => p.accountId === account.id)) throw new LobbyError('Partida não encontrada', 404);
    if (m.status !== 'finished') throw new LobbyError('A partida ainda não terminou', 409);
    const info = await this.svc.matches.mode(matchId);
    if (this.busy(account.id)) throw new LobbyError('Você já está numa partida', 409);
    if (info?.mode === 'bot') {
      const diff = info.botDifficulty;
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') throw new LobbyError('Revanche indisponível para esta partida', 409);
      this.queue.delete(account.id);
      return { status: 'created', roomId: await this.createMatch('bot', [account], diff, { rematchOf: matchId }) };
    }
    if (info?.mode !== 'pvp' && info?.mode !== 'private') throw new LobbyError('Revanche indisponível para esta partida', 409);
    const oppId = players.find((p) => p.accountId !== account.id)?.accountId;
    const opp = oppId ? await this.svc.accounts.byId(oppId) : null;
    if (!opp) throw new LobbyError('Adversário não encontrado', 404);
    for (const inv of this.invites.values()) {
      if (inv.status !== 'pending' || inv.rematchOf !== matchId) continue;
      if (inv.from.id === opp.id && inv.to.id === account.id) return { status: 'created', roomId: await this.accept(account, inv.id) };
      if (inv.from.id === account.id) return { status: 'waiting', inviteId: inv.id, opponent: opp.displayName };
    }
    await this.seatFor(account, 0);
    const inv: Invite = { id: randomUUID(), from: account, to: opp, createdAt: this.now(), status: 'pending', rematchOf: matchId, mode: info.mode };
    this.invites.set(inv.id, inv);
    this.svc.log(`[lobby] revanche pedida: ${account.username} → ${opp.username} (partida ${matchId.slice(0, 8)})`);
    return { status: 'waiting', inviteId: inv.id, opponent: opp.displayName };
  }

  // --- Status (consulta do cliente) ---------------------------------------------------------

  async status(account: Account): Promise<LobbyStatusDto> {
    const now = this.now();
    const q = this.queue.get(account.id);
    if (q) q.lastPoll = now;
    await this.pair();
    for (const inv of this.invites.values()) if (inv.status === 'pending' && now - inv.createdAt > INVITE_TTL_MS) inv.status = 'expired';
    let match = this.pending.get(account.id) ?? null;
    if (match && now - match.createdAt > PENDING_TTL_MS) {
      this.pending.delete(account.id);
      match = null;
    }
    const active = match ? null : this.activeRoomOf(account.id);
    const queue = this.queue.get(account.id);
    return {
      queue: queue ? { since: queue.since, waitingSeconds: Math.round((now - queue.since) / 1000), size: this.queue.size } : null,
      invites: {
        incoming: [...this.invites.values()].filter((i) => i.to.id === account.id && i.status === 'pending').map((i) => this.dto(i)),
        outgoing: [...this.invites.values()].filter((i) => i.from.id === account.id && (i.status === 'pending' || now - i.createdAt < 15000)).map((i) => this.dto(i)),
      },
      match: match ? { roomId: match.roomId, mode: match.mode } : active,
    };
  }

  /**
   * Fase 6: a partida montada foi cancelada porque alguém não entrou no prazo. Quem entrou volta
   * para o começo da fila (partida da fila) e quem faltou sai da fila; no convite, ninguém volta
   * (o convite já foi aceito; basta convidar de novo).
   */
  matchCancelled(roomId: string, mode: string, joined: Account[], missing: Account[]): void {
    for (const a of [...joined, ...missing]) if (this.pending.get(a.id)?.roomId === roomId) this.pending.delete(a.id);
    for (const a of missing) this.queue.delete(a.id);
    if (mode !== 'pvp') return;
    const now = this.now();
    const front = new Map<string, QueueEntry>();
    for (const a of joined) front.set(a.id, { account: a, since: now, lastPoll: now });
    for (const [id, e] of this.queue) if (!front.has(id)) front.set(id, e);
    this.queue.clear();
    for (const [id, e] of front) this.queue.set(id, e);
    this.svc.log(`[lobby] sala ${roomId} cancelada; de volta à fila: ${joined.map((a) => a.username).join(', ') || 'ninguém'}`);
    void this.pair();
  }

  /** A conta entrou na sala: a partida pendente foi entregue. */
  joined(accountId: string): void {
    this.pending.delete(accountId);
  }
}

const BOT_NAMES: Record<BotDifficultyId, string> = { easy: 'fácil', normal: 'normal', hard: 'difícil' };
const BOT_CLASSES = ['warrior', 'mage', 'rogue', 'druid'];
const BOT_ACCESSORIES = [null, 'accessory.vitality_amulet', 'accessory.ash_medallion', 'accessory.frost_medallion'];

/** Personagem do bot: classe e acessório sorteados; consumíveis padrão (Poção de vida + Poção de Foco). */
function botCharacter(rng: () => number) {
  return {
    classId: BOT_CLASSES[Math.floor(rng() * BOT_CLASSES.length)]!,
    accessoryId: BOT_ACCESSORIES[Math.floor(rng() * BOT_ACCESSORIES.length)] ?? null,
    consumables: ['consumable.health_potion', 'consumable.focus_potion'],
  };
}
