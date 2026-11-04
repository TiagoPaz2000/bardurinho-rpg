/**
 * Repositórios (camada de persistência, seção 9): SQL fica aqui, regras ficam no domínio.
 */
import type { GameEvent, GameState, MatchResult } from '@bardurinho/domain';
import type { Database, Queryable } from './database.js';

export { AccountsRepository, hashPassword, verifyPassword, type Account } from './accounts.js';

export interface CommandRecord {
  seq: number;
  commandId: string;
  authorKind: 'player' | 'timer' | 'server';
  accountId: string | null;
  seat: number | null;
  turnId: number;
  payload: unknown;
  accepted: boolean;
  error: unknown;
  versionAfter: number | null;
}

export interface MatchRow {
  id: string;
  roomId: string;
  mapId: string;
  seed: number;
  turnSeconds: number;
  status: string;
  result: MatchResult | null;
}

const json = (v: unknown) => JSON.stringify(v);

export class MatchesRepository {
  constructor(private readonly db: Database) {}

  async create(m: { id: string; roomId: string; mapId: string; state: GameState; seed: number; turnSeconds: number; hash: string; mode?: string; botDifficulty?: string | null; rematchOf?: string | null }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO matches (id, room_id, map_id, rules_version, content_version, seed, turn_seconds, status, mode, bot_difficulty, rematch_of) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [m.id, m.roomId, m.mapId, m.state.rulesVersion, m.state.contentVersion, m.seed, m.turnSeconds, m.state.status, m.mode ?? 'custom', m.botDifficulty ?? null, m.rematchOf ?? null],
      );
      await this.insertSnapshot(tx, m.id, 0, m.state, m.hash);
    });
  }

  /**
   * Fase 4: a composição das equipes (classes/acessórios/consumíveis escolhidos ao entrar) só
   * fica definida com os dois assentos ocupados, antes do START_MATCH. Enquanto nada foi
   * jogado (versão 0), o snapshot inicial é substituído pela montagem final.
   */
  async replaceInitialSnapshot(matchId: string, state: GameState, hash: string): Promise<void> {
    await this.db.query('UPDATE match_snapshots SET state = $3::jsonb, state_hash = $4 WHERE match_id = $1 AND version = $2', [matchId, 0, json(state), hash]);
  }

  async addPlayer(matchId: string, seat: number, team: string, accountId: string, character?: { id: string | null; snapshot: unknown } | null): Promise<void> {
    await this.db.query('INSERT INTO match_players (match_id, seat, team, account_id, character_id, character) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING', [
      matchId,
      seat,
      team,
      accountId,
      character?.id ?? null,
      character ? json(character.snapshot) : null,
    ]);
  }

  /**
   * Fase 6: partida que não vai continuar (cancelada antes do início, sala abandonada sem
   * ninguém, ou deixada pelo processo anterior): sai de `setup`/`active` para `status`
   * (`cancelled` / `aborted`), sem resultado nem recompensa.
   */
  async abort(matchId: string, status: 'cancelled' | 'aborted'): Promise<void> {
    await this.db.query("UPDATE matches SET status = $2, finished_at = now() WHERE id = $1 AND status IN ('setup', 'active')", [matchId, status]);
  }

  /** Fase 6: na inicialização, partidas do processo anterior (salas em memória perdidas) → `aborted`. */
  async abortStale(): Promise<number> {
    const rows = await this.db.query("UPDATE matches SET status = 'aborted', finished_at = now() WHERE status IN ('setup', 'active') RETURNING id");
    return rows.length;
  }

  async mode(matchId: string): Promise<{ mode: string; botDifficulty: string | null } | null> {
    const rows = await this.db.query<{ mode: string; bot_difficulty: string | null }>('SELECT mode, bot_difficulty FROM matches WHERE id = $1', [matchId]);
    return rows[0] ? { mode: rows[0].mode, botDifficulty: rows[0].bot_difficulty } : null;
  }

  private insertSnapshot(tx: Queryable, matchId: string, version: number, state: GameState, hash: string) {
    return tx.query('INSERT INTO match_snapshots (match_id, version, state, state_hash) VALUES ($1, $2, $3::jsonb, $4)', [matchId, version, json(state), hash]);
  }

  /**
   * Comando aceito: registro do comando + eventos + snapshot da nova versão, numa transação
   * (etapa 10 da seção 11.2). Só depois disso o estado candidato vira oficial.
   */
  async saveAccepted(matchId: string, rec: Omit<CommandRecord, 'accepted' | 'error'> & { versionAfter: number }, events: readonly GameEvent[], state: GameState, hash: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.insertCommand(tx, matchId, { ...rec, accepted: true, error: null });
      for (const e of events) {
        await tx.query('INSERT INTO match_events (match_id, seq, version, type, event) VALUES ($1, $2, $3, $4, $5::jsonb)', [matchId, e.seq, rec.versionAfter, e.type, json(e)]);
      }
      await this.insertSnapshot(tx, matchId, rec.versionAfter, state, hash);
      if (state.status === 'active') await tx.query("UPDATE matches SET status = 'active', started_at = COALESCE(started_at, now()) WHERE id = $1", [matchId]);
      if (state.status === 'finished' && state.result) {
        await tx.query("UPDATE matches SET status = 'finished', result = $2::jsonb, finished_at = now() WHERE id = $1", [matchId, json(state.result)]);
        const commands = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM match_commands WHERE match_id = $1 AND accepted', [matchId]);
        await tx.query(
          'INSERT INTO match_results (match_id, result, winner_team, rounds, turns, commands, final_hash) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)',
          [matchId, json(state.result), state.result.kind === 'victory' ? state.result.winnerTeam : null, state.turn.round, state.turn.turnId, commands[0]?.n ?? 0, hash],
        );
      }
    });
  }

  /** Comando recusado: só o registro (auditoria). Repetições do mesmo commandId não entram. */
  async saveRejected(matchId: string, rec: Omit<CommandRecord, 'accepted' | 'versionAfter'>): Promise<void> {
    await this.insertCommand(this.db, matchId, { ...rec, accepted: false, versionAfter: null });
  }

  private insertCommand(tx: Queryable, matchId: string, r: CommandRecord) {
    return tx.query(
      `INSERT INTO match_commands (match_id, seq, command_id, author_kind, account_id, seat, turn_id, payload, accepted, error, version_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)`,
      [matchId, r.seq, r.commandId, r.authorKind, r.accountId, r.seat, r.turnId, json(r.payload), r.accepted, r.error === null ? null : json(r.error), r.versionAfter],
    );
  }

  async get(matchId: string): Promise<MatchRow | null> {
    const rows = await this.db.query<{ id: string; room_id: string; map_id: string; seed: number; turn_seconds: number; status: string; result: MatchResult | null }>(
      'SELECT id, room_id, map_id, seed, turn_seconds, status, result FROM matches WHERE id = $1',
      [matchId],
    );
    const r = rows[0];
    return r ? { id: r.id, roomId: r.room_id, mapId: r.map_id, seed: Number(r.seed), turnSeconds: r.turn_seconds, status: r.status, result: r.result } : null;
  }

  async commands(matchId: string): Promise<CommandRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM match_commands WHERE match_id = $1 ORDER BY seq', [matchId]);
    return rows.map((r) => ({
      seq: r.seq as number,
      commandId: r.command_id as string,
      authorKind: r.author_kind as CommandRecord['authorKind'],
      accountId: (r.account_id as string | null) ?? null,
      seat: (r.seat as number | null) ?? null,
      turnId: r.turn_id as number,
      payload: r.payload,
      accepted: r.accepted as boolean,
      error: r.error ?? null,
      versionAfter: (r.version_after as number | null) ?? null,
    }));
  }

  async events(matchId: string): Promise<GameEvent[]> {
    const rows = await this.db.query<{ event: GameEvent }>('SELECT event FROM match_events WHERE match_id = $1 ORDER BY seq', [matchId]);
    return rows.map((r) => r.event);
  }

  async eventsOfVersion(matchId: string, version: number): Promise<GameEvent[]> {
    const rows = await this.db.query<{ event: GameEvent }>('SELECT event FROM match_events WHERE match_id = $1 AND version = $2 ORDER BY seq', [matchId, version]);
    return rows.map((x) => x.event);
  }

  async snapshot(matchId: string, version?: number): Promise<{ version: number; state: GameState; hash: string } | null> {
    const rows =
      version === undefined
        ? await this.db.query<{ version: number; state: GameState; state_hash: string }>('SELECT version, state, state_hash FROM match_snapshots WHERE match_id = $1 ORDER BY version DESC LIMIT 1', [matchId])
        : await this.db.query<{ version: number; state: GameState; state_hash: string }>('SELECT version, state, state_hash FROM match_snapshots WHERE match_id = $1 AND version = $2', [matchId, version]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state, hash: r.state_hash } : null;
  }

  async result(matchId: string): Promise<{ result: MatchResult; winnerTeam: string | null; rounds: number; turns: number; commands: number; finalHash: string } | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM match_results WHERE match_id = $1', [matchId]);
    const r = rows[0];
    return r
      ? { result: r.result as MatchResult, winnerTeam: (r.winner_team as string | null) ?? null, rounds: r.rounds as number, turns: r.turns as number, commands: r.commands as number, finalHash: r.final_hash as string }
      : null;
  }

  async players(matchId: string): Promise<Array<{ seat: number; team: string; accountId: string }>> {
    const rows = await this.db.query<{ seat: number; team: string; account_id: string }>('SELECT seat, team, account_id FROM match_players WHERE match_id = $1 ORDER BY seat', [matchId]);
    return rows.map((r) => ({ seat: r.seat, team: r.team, accountId: r.account_id }));
  }

  async recent(limit = 20): Promise<MatchRow[]> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM matches ORDER BY created_at DESC LIMIT $1', [limit]);
    const out: MatchRow[] = [];
    for (const r of rows) {
      const m = await this.get(r.id);
      if (m) out.push(m);
    }
    return out;
  }
}
