/**
 * Fase 7: persistência do teste externo — códigos de convite, telemetria do cliente (anônima),
 * pesquisas pós-partida e relatórios de bug. Nenhuma destas tabelas guarda usuário, nome, IP
 * nem token: o jogador aparece só pelo `analytics_id` (aleatório) da conta.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { TelemetryBatch } from '@bardurinho/protocol';
import type { Database, Queryable } from './database.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newInviteCode = (prefix = 'BARD'): string => `${prefix}-${Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
export const normalizeCode = (code: string): string => code.trim().toUpperCase().slice(0, 40);

export interface InviteCodeRow {
  code: string;
  label: string | null;
  maxUses: number;
  uses: number;
  disabled: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface SurveyRecord {
  matchId: string;
  analyticsId: string;
  mode: string | null;
  botDifficulty: string | null;
  outcome: string | null;
  classId: string | null;
  fun: number;
  clarity: number | null;
  camera: number | null;
  balance: number | null;
  botRating: number | null;
  playAgain: string | null;
  comment: string | null;
  build: string | null;
}

export class PlaytestRepository {
  constructor(private readonly db: Database) {}

  // --- Convites ---------------------------------------------------------------------

  /** Cria (ou mantém) um código; `ensure` é idempotente (códigos do `INVITE_CODES`). */
  async ensureInvite(code: string, maxUses: number, label: string | null = null): Promise<void> {
    await this.db.query('INSERT INTO invite_codes (code, label, max_uses) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING', [normalizeCode(code), label, maxUses]);
  }

  async createInvites(count: number, maxUses: number, label: string | null, prefix?: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 5; tries++) {
        const code = newInviteCode(prefix);
        const r = await this.db.query('INSERT INTO invite_codes (code, label, max_uses) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING code', [code, label, maxUses]);
        if (r.length) {
          out.push(code);
          break;
        }
      }
    }
    return out;
  }

  async invites(): Promise<InviteCodeRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM invite_codes ORDER BY created_at, code');
    return rows.map((r) => ({
      code: r.code as string,
      label: (r.label as string | null) ?? null,
      maxUses: r.max_uses as number,
      uses: r.uses as number,
      disabled: r.disabled as boolean,
      createdAt: new Date(r.created_at as string).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
    }));
  }

  async disableInvite(code: string): Promise<boolean> {
    return (await this.db.query('UPDATE invite_codes SET disabled = true WHERE code = $1 RETURNING code', [normalizeCode(code)])).length > 0;
  }

  /** Consome um uso do código dentro da transação do cadastro; false = inválido/esgotado. */
  static async consumeInvite(tx: Queryable, code: string): Promise<boolean> {
    const r = await tx.query(
      'UPDATE invite_codes SET uses = uses + 1 WHERE code = $1 AND NOT disabled AND uses < max_uses AND (expires_at IS NULL OR expires_at > now()) RETURNING code',
      [normalizeCode(code)],
    );
    return r.length > 0;
  }

  // --- Conta → id anônimo, consentimento ------------------------------------------------

  async analyticsId(accountId: string): Promise<string | null> {
    const r = await this.db.query<{ analytics_id: string }>('SELECT analytics_id FROM accounts WHERE id = $1', [accountId]);
    return r[0]?.analytics_id ?? null;
  }

  async setConsent(accountId: string, consent: boolean): Promise<void> {
    await this.db.query('UPDATE accounts SET telemetry_consent = $2, telemetry_consent_at = now() WHERE id = $1', [accountId, consent]);
  }

  // --- Telemetria ---------------------------------------------------------------------

  async insertEvents(batch: TelemetryBatch, analyticsId: string | null): Promise<number> {
    if (!batch.events.length) return 0;
    // Um INSERT com várias linhas (até 50 eventos × 8 parâmetros).
    const params: unknown[] = [];
    const values: string[] = [];
    for (const e of batch.events) {
      const b = params.length;
      params.push(batch.clientId, batch.sessionId, analyticsId, e.type, e.matchId ?? null, JSON.stringify(e.props ?? {}), batch.build || null, new Date(e.t).toISOString());
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}, $${b + 8}::timestamptz)`);
    }
    await this.db.query(`INSERT INTO analytics_events (client_id, session_id, analytics_id, type, match_id, props, build, client_ts) VALUES ${values.join(', ')}`, params);
    return batch.events.length;
  }

  // --- Pesquisa e bug -------------------------------------------------------------------

  /** Grava a pesquisa; `false` = já respondida para esta partida. */
  async insertSurvey(s: SurveyRecord): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO feedback_surveys (match_id, analytics_id, mode, bot_difficulty, outcome, class_id, fun, clarity, camera, balance, bot_rating, play_again, comment, build)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (match_id, analytics_id) DO NOTHING RETURNING id`,
      [s.matchId, s.analyticsId, s.mode, s.botDifficulty, s.outcome, s.classId, s.fun, s.clarity, s.camera, s.balance, s.botRating, s.playAgain, s.comment, s.build],
    );
    return r.length > 0;
  }

  async insertBug(b: { analyticsId: string | null; matchId: string | null; category: string; description: string; client: Record<string, unknown>; report: unknown; build: string | null }): Promise<string> {
    const id = randomUUID();
    await this.db.query('INSERT INTO bug_reports (id, analytics_id, match_id, category, description, client, report, build) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)', [
      id,
      b.analyticsId,
      b.matchId,
      b.category,
      b.description,
      JSON.stringify(b.client),
      b.report === null ? null : JSON.stringify(b.report),
      b.build,
    ]);
    return id;
  }

  async bugs(limit = 200): Promise<Array<{ id: string; analyticsId: string | null; matchId: string | null; category: string; description: string; client: unknown; build: string | null; createdAt: string; hasReport: boolean }>> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT id, analytics_id, match_id, category, description, client, build, created_at, report IS NOT NULL AS has_report FROM bug_reports ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      analyticsId: (r.analytics_id as string | null) ?? null,
      matchId: (r.match_id as string | null) ?? null,
      category: r.category as string,
      description: r.description as string,
      client: r.client,
      build: (r.build as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      hasReport: r.has_report as boolean,
    }));
  }

  async bug(id: string): Promise<{ id: string; report: unknown; description: string; category: string; matchId: string | null; createdAt: string } | null> {
    const r = await this.db.query<Record<string, unknown>>('SELECT id, report, description, category, match_id, created_at FROM bug_reports WHERE id = $1', [id]);
    const x = r[0];
    return x ? { id: x.id as string, report: x.report, description: x.description as string, category: x.category as string, matchId: (x.match_id as string | null) ?? null, createdAt: new Date(x.created_at as string).toISOString() } : null;
  }
}

/** Fase 7: marca a conta como ativa hoje (UTC) — base do retorno D1/D7. Idempotente. */
export async function markActiveDay(db: Database, accountId: string): Promise<void> {
  await db.query("INSERT INTO account_days (account_id, day) VALUES ($1, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING", [accountId]);
}
