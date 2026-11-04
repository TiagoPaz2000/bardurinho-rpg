/**
 * Fase 5: perfil do jogador — personagens, inventário (cosméticos), moedas, loja, missões,
 * recompensas de partida e histórico. SQL aqui; as regras (preços, posse, recompensa, missões)
 * vêm do conteúdo (`@bardurinho/content`) e são aplicadas em `modules/progression`.
 */
import { randomUUID } from 'node:crypto';
import type { CharacterDto, HistoryEntryDto, MatchRewardDto } from '@bardurinho/protocol';
import type { Database, Queryable } from './database.js';

type CharacterRow = { id: string; account_id: string; name: string; class_id: string; appearance: Record<string, string>; accessory_id: string | null; consumables: string[] };
const toCharacter = (r: CharacterRow): CharacterDto => ({ id: r.id, name: r.name, classId: r.class_id, appearance: r.appearance, accessoryId: r.accessory_id, consumables: r.consumables });

export interface AccountProfile {
  id: string;
  username: string;
  displayName: string;
  kind: string;
  friendCode: string;
  coins: number;
  activeCharacterId: string | null;
}

export class ProfileRepository {
  constructor(private readonly db: Database) {}

  async account(accountId: string, q: Queryable = this.db): Promise<AccountProfile | null> {
    const rows = await q.query<{ id: string; username: string; display_name: string; kind: string; friend_code: string | null; coins: number; active_character_id: string | null }>(
      'SELECT id, username, display_name, kind, friend_code, coins, active_character_id FROM accounts WHERE id = $1',
      [accountId],
    );
    const r = rows[0];
    return r ? { id: r.id, username: r.username, displayName: r.display_name, kind: r.kind, friendCode: r.friend_code ?? '', coins: r.coins, activeCharacterId: r.active_character_id } : null;
  }

  // --- Personagens ------------------------------------------------------------------

  async characters(accountId: string): Promise<CharacterDto[]> {
    const rows = await this.db.query<CharacterRow>('SELECT * FROM characters WHERE account_id = $1 ORDER BY created_at, id', [accountId]);
    return rows.map(toCharacter);
  }

  async character(accountId: string, id: string): Promise<CharacterDto | null> {
    const rows = await this.db.query<CharacterRow>('SELECT * FROM characters WHERE account_id = $1 AND id = $2', [accountId, id]);
    return rows[0] ? toCharacter(rows[0]) : null;
  }

  async activeCharacter(accountId: string): Promise<CharacterDto | null> {
    const rows = await this.db.query<CharacterRow>('SELECT c.* FROM characters c JOIN accounts a ON a.active_character_id = c.id WHERE a.id = $1', [accountId]);
    return rows[0] ? toCharacter(rows[0]) : null;
  }

  /** Cria o personagem e o seleciona; null se o nome já existe na conta ou o limite foi atingido. */
  createCharacter(accountId: string, c: Omit<CharacterDto, 'id'>, max: number): Promise<CharacterDto | 'duplicate' | 'limit'> {
    const id = randomUUID();
    return this.db.transaction(async (tx) => {
      const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [accountId]);
      if ((count[0]?.n ?? 0) >= max) return 'limit';
      const key = c.name.trim().toLowerCase();
      if ((await tx.query('SELECT 1 FROM characters WHERE account_id = $1 AND name_key = $2', [accountId, key])).length) return 'duplicate';
      await tx.query(
        'INSERT INTO characters (id, account_id, name, name_key, class_id, appearance, accessory_id, consumables) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)',
        [id, accountId, c.name.trim(), key, c.classId, JSON.stringify(c.appearance), c.accessoryId, JSON.stringify(c.consumables)],
      );
      await tx.query('UPDATE accounts SET active_character_id = $2 WHERE id = $1', [accountId, id]);
      return { ...c, name: c.name.trim(), id };
    });
  }

  async updateCharacter(accountId: string, id: string, patch: { appearance: Record<string, string>; accessoryId: string | null; consumables: string[] }): Promise<CharacterDto | null> {
    const rows = await this.db.query<CharacterRow>(
      'UPDATE characters SET appearance = $3::jsonb, accessory_id = $4, consumables = $5::jsonb, updated_at = now() WHERE account_id = $1 AND id = $2 RETURNING *',
      [accountId, id, JSON.stringify(patch.appearance), patch.accessoryId, JSON.stringify(patch.consumables)],
    );
    return rows[0] ? toCharacter(rows[0]) : null;
  }

  async selectCharacter(accountId: string, id: string): Promise<boolean> {
    const rows = await this.db.query('UPDATE accounts SET active_character_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM characters WHERE id = $2 AND account_id = $1) RETURNING id', [accountId, id]);
    return rows.length > 0;
  }

  // --- Inventário e moedas ------------------------------------------------------------

  async inventory(accountId: string, q: Queryable = this.db): Promise<string[]> {
    const rows = await q.query<{ item_id: string }>('SELECT item_id FROM inventory WHERE account_id = $1 ORDER BY acquired_at, item_id', [accountId]);
    return rows.map((r) => r.item_id);
  }

  /** Concede um cosmético (idempotente); devolve true se era novo. */
  async grantItem(q: Queryable, accountId: string, itemId: string, source: string): Promise<boolean> {
    const rows = await q.query('INSERT INTO inventory (account_id, item_id, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING item_id', [accountId, itemId, source]);
    return rows.length > 0;
  }

  /**
   * Movimenta moedas com registro no histórico. `(reason, ref)` único por conta: repetir a
   * mesma movimentação não altera o saldo (devolve null). Débito sem saldo → 'insufficient'.
   */
  async moveCoins(q: Queryable, accountId: string, delta: number, reason: string, ref: string): Promise<number | null | 'insufficient'> {
    if ((await q.query('SELECT 1 FROM coin_ledger WHERE account_id = $1 AND reason = $2 AND ref = $3', [accountId, reason, ref])).length) return null;
    const rows = await q.query<{ coins: number }>('UPDATE accounts SET coins = coins + $2 WHERE id = $1 AND coins + $2 >= 0 RETURNING coins', [accountId, delta]);
    if (!rows[0]) return 'insufficient';
    await q.query('INSERT INTO coin_ledger (account_id, delta, balance_after, reason, ref) VALUES ($1, $2, $3, $4, $5)', [accountId, delta, rows[0].coins, reason, ref]);
    return rows[0].coins;
  }

  async ledger(accountId: string, limit = 20): Promise<Array<{ delta: number; balanceAfter: number; reason: string; ref: string }>> {
    const rows = await this.db.query<{ delta: number; balance_after: number; reason: string; ref: string }>('SELECT delta, balance_after, reason, ref FROM coin_ledger WHERE account_id = $1 ORDER BY id DESC LIMIT $2', [accountId, limit]);
    return rows.map((r) => ({ delta: r.delta, balanceAfter: r.balance_after, reason: r.reason, ref: r.ref }));
  }

  // --- Compras ------------------------------------------------------------------------

  async purchaseByRequest(accountId: string, requestId: string): Promise<{ productId: string; status: string; error: string | null } | null> {
    const rows = await this.db.query<{ product_id: string; status: string; error: string | null }>('SELECT product_id, status, error FROM purchases WHERE account_id = $1 AND request_id = $2', [accountId, requestId]);
    return rows[0] ? { productId: rows[0].product_id, status: rows[0].status, error: rows[0].error } : null;
  }

  /**
   * Compra numa transação: registra a solicitação, debita (sem saldo negativo), concede o item.
   * Qualquer falha grava a compra como recusada, sem mexer no saldo nem no inventário.
   */
  buy(accountId: string, requestId: string, productId: string, price: number): Promise<{ ok: boolean; error?: string; balance: number }> {
    return this.db.transaction(async (tx) => {
      const record = async (status: string, error: string | null) =>
        tx.query('INSERT INTO purchases (id, account_id, request_id, product_id, price, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7)', [randomUUID(), accountId, requestId, productId, price, status, error]);
      const balance = async () => (await this.account(accountId, tx))?.coins ?? 0;
      if ((await tx.query('SELECT 1 FROM inventory WHERE account_id = $1 AND item_id = $2', [accountId, productId])).length) {
        await record('rejected', 'Você já possui este item');
        return { ok: false, error: 'Você já possui este item', balance: await balance() };
      }
      const after = await this.moveCoins(tx, accountId, -price, 'purchase', requestId);
      if (after === 'insufficient') {
        await record('rejected', 'Moedas insuficientes');
        return { ok: false, error: 'Moedas insuficientes', balance: await balance() };
      }
      await this.grantItem(tx, accountId, productId, 'shop');
      await record('completed', null);
      return { ok: true, balance: after ?? (await balance()) };
    });
  }

  // --- Missões ------------------------------------------------------------------------

  async missionProgress(accountId: string, keys: Array<{ missionId: string; period: string }>, q: Queryable = this.db): Promise<Map<string, { progress: number; completed: boolean }>> {
    const out = new Map<string, { progress: number; completed: boolean }>();
    if (!keys.length) return out;
    const rows = await q.query<{ mission_id: string; period: string; progress: number; completed_at: string | null }>('SELECT mission_id, period, progress, completed_at FROM mission_progress WHERE account_id = $1', [accountId]);
    for (const r of rows) out.set(`${r.mission_id}|${r.period}`, { progress: r.progress, completed: !!r.completed_at });
    return out;
  }

  async setMissionProgress(q: Queryable, accountId: string, missionId: string, period: string, progress: number, completed: boolean): Promise<void> {
    await q.query(
      `INSERT INTO mission_progress (account_id, mission_id, period, progress, completed_at) VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
       ON CONFLICT (account_id, mission_id, period) DO UPDATE SET progress = EXCLUDED.progress, completed_at = COALESCE(mission_progress.completed_at, EXCLUDED.completed_at)`,
      [accountId, missionId, period, progress, completed],
    );
  }

  // --- Recompensas e histórico -----------------------------------------------------------

  /** Reserva a recompensa da partida para a conta; false se já existia (idempotência). */
  async claimReward(q: Queryable, matchId: string, accountId: string, outcome: string, coins: number, stats: unknown): Promise<boolean> {
    const rows = await q.query('INSERT INTO match_rewards (match_id, account_id, outcome, coins, stats, missions) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) ON CONFLICT DO NOTHING RETURNING match_id', [
      matchId,
      accountId,
      outcome,
      coins,
      JSON.stringify(stats),
      '[]',
    ]);
    return rows.length > 0;
  }

  async saveRewardDetails(q: Queryable, matchId: string, accountId: string, details: MatchRewardDto): Promise<void> {
    await q.query('UPDATE match_rewards SET missions = $3::jsonb WHERE match_id = $1 AND account_id = $2', [matchId, accountId, JSON.stringify(details)]);
  }

  async reward(matchId: string, accountId: string): Promise<MatchRewardDto | null> {
    const rows = await this.db.query<{ missions: MatchRewardDto | unknown[] }>('SELECT missions FROM match_rewards WHERE match_id = $1 AND account_id = $2', [matchId, accountId]);
    const d = rows[0]?.missions;
    return d && !Array.isArray(d) ? (d as MatchRewardDto) : null;
  }

  async history(accountId: string, limit = 20): Promise<HistoryEntryDto[]> {
    const rows = await this.db.query<{
      id: string;
      mode: string;
      bot_difficulty: string | null;
      finished_at: string | Date;
      result: { kind: string; winnerTeam?: string; reason?: string } | null;
      team: string;
      character: { name: string; classId: string } | null;
      coins: number | null;
      outcome: string | null;
      rounds: number | null;
      opponent: { name: string | null; classId: string | null; username: string } | null;
    }>(
      `SELECT m.id, m.mode, m.bot_difficulty, m.finished_at, m.result, mp.team, mp.character, r.coins, r.outcome, mr.rounds,
         (SELECT jsonb_build_object('name', COALESCE(o.character->>'name', a2.display_name), 'classId', o.character->>'classId', 'username', a2.username)
            FROM match_players o JOIN accounts a2 ON a2.id = o.account_id WHERE o.match_id = m.id AND o.account_id <> mp.account_id LIMIT 1) AS opponent
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN match_rewards r ON r.match_id = m.id AND r.account_id = mp.account_id
       LEFT JOIN match_results mr ON mr.match_id = m.id
       WHERE mp.account_id = $1 AND m.status = 'finished'
       ORDER BY m.finished_at DESC NULLS LAST LIMIT $2`,
      [accountId, limit],
    );
    return rows.map((r) => {
      const res = r.result;
      const outcome = (r.outcome as HistoryEntryDto['outcome'] | null) ?? (!res || res.kind === 'draw' ? 'draw' : res.winnerTeam === r.team ? 'victory' : 'defeat');
      return {
        matchId: r.id,
        mode: r.mode,
        botDifficulty: r.bot_difficulty,
        finishedAt: new Date(r.finished_at).toISOString(),
        outcome,
        reason: res?.reason ?? null,
        coins: r.coins ?? 0,
        rounds: r.rounds,
        character: r.character ? { name: r.character.name, classId: r.character.classId } : null,
        opponent: r.opponent ? { name: r.opponent.name ?? r.opponent.username, classId: r.opponent.classId, username: r.opponent.username } : null,
      };
    });
  }
}
