/**
 * Contas e sessões (Fases 3 e 5): senha com scrypt (sal aleatório por conta, comparação em
 * tempo constante), sessões por token aleatório com validade de 7 dias, código de amigo para
 * convites e moedas de boas-vindas no cadastro.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from './database.js';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  /** Fase 5: `player` (cadastro), `dev` (contas de desenvolvimento) ou `bot`. */
  kind?: string;
}

export const SESSION_HOURS = 24 * 7;
const FRIEND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return ['scrypt', salt, scryptSync(password, salt, 32).toString('hex')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newFriendCode = (): string => Array.from(randomBytes(6), (b) => FRIEND_ALPHABET[b % FRIEND_ALPHABET.length]).join('');

type AccountRow = { id: string; username: string; display_name: string; kind: string };
const toAccount = (r: AccountRow): Account => ({ id: r.id, username: r.username, displayName: r.display_name, kind: r.kind });
const COLS = 'id, username, display_name, kind';

export class AccountsRepository {
  constructor(private readonly db: Database) {}

  /** Conta de desenvolvimento/bot criada na inicialização (idempotente). */
  async ensure(username: string, displayName: string, password: string, kind = 'dev'): Promise<Account> {
    const found = await this.byUsername(username);
    if (found) return found;
    // Bots não entram por senha.
    const hash = kind === 'bot' ? 'disabled' : hashPassword(password);
    await this.db.query('INSERT INTO accounts (id, username, display_name, password_hash, kind, friend_code) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO NOTHING', [
      randomUUID(),
      username,
      displayName,
      hash,
      kind,
      newFriendCode(),
    ]);
    return (await this.byUsername(username))!;
  }

  /**
   * Cadastro (Fase 5): código de amigo único e moedas de boas-vindas registradas no histórico
   * de movimentações. Devolve null se o usuário já existe.
   */
  register(username: string, password: string, displayName: string, welcomeCoins: number): Promise<Account | null> {
    const id = randomUUID();
    const hash = hashPassword(password);
    return this.db.transaction(async (tx) => {
      if ((await tx.query('SELECT 1 FROM accounts WHERE username = $1', [username])).length) return null;
      let code = newFriendCode();
      for (let i = 0; i < 5 && (await tx.query('SELECT 1 FROM accounts WHERE friend_code = $1', [code])).length; i++) code = newFriendCode();
      await tx.query('INSERT INTO accounts (id, username, display_name, password_hash, kind, friend_code, coins) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, username, displayName, hash, 'player', code, welcomeCoins]);
      if (welcomeCoins > 0) await tx.query('INSERT INTO coin_ledger (account_id, delta, balance_after, reason, ref) VALUES ($1, $2, $2, $3, $4)', [id, welcomeCoins, 'welcome', 'account']);
      return { id, username, displayName, kind: 'player' };
    });
  }

  async byUsername(username: string): Promise<Account | null> {
    const rows = await this.db.query<AccountRow>(`SELECT ${COLS} FROM accounts WHERE username = $1`, [username]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async byId(id: string): Promise<Account | null> {
    const rows = await this.db.query<AccountRow>(`SELECT ${COLS} FROM accounts WHERE id = $1`, [id]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  /** Conta por usuário ou código de amigo (convites); bots ficam de fora. */
  async findPlayer(query: string): Promise<Account | null> {
    const q = query.trim();
    const rows = await this.db.query<AccountRow>(`SELECT ${COLS} FROM accounts WHERE (username = lower($1) OR friend_code = upper($1)) AND kind <> 'bot'`, [q]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  /** Confere a senha e abre uma sessão; devolve o token. */
  async login(username: string, password: string): Promise<{ token: string; expiresAt: number; account: Account } | null> {
    const rows = await this.db.query<AccountRow & { password_hash: string }>(`SELECT ${COLS}, password_hash FROM accounts WHERE username = $1`, [username]);
    const r = rows[0];
    if (!r || r.kind === 'bot' || !verifyPassword(password, r.password_hash)) return null;
    return { ...(await this.openSession(r.id)), account: toAccount(r) };
  }

  async openSession(accountId: string): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(24).toString('base64url');
    const rows = await this.db.query<{ expires_at: string | Date }>(
      `INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours') RETURNING expires_at`,
      [token, accountId],
    );
    return { token, expiresAt: new Date(rows[0]!.expires_at).getTime() };
  }

  async logout(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  /** Conta da sessão (token válido e não expirado). */
  async bySession(token: string): Promise<Account | null> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
    const rows = await this.db.query<AccountRow>(
      'SELECT a.id, a.username, a.display_name, a.kind FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1 AND s.expires_at > now()',
      [token],
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }
}
