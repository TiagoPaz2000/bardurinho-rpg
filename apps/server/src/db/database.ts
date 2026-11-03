/**
 * Acesso ao PostgreSQL (seção 10). Dois adaptadores atrás da mesma interface:
 *
 * - **PGlite** (padrão): PostgreSQL de verdade compilado para WASM, embutido no processo e
 *   persistido em disco (`DATA_DIR`, padrão `.data/pg`). Escolhido porque a máquina de
 *   desenvolvimento não tem PostgreSQL nem Docker. `DATA_DIR=memory` usa memória (testes).
 * - **pg** (`DATABASE_URL=postgres://…`): servidor PostgreSQL externo, sem mudar o SQL.
 *
 * O banco não decide regra de gameplay (seção 17.8): guarda contas, partidas, comandos,
 * eventos, snapshots e resultados.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  readonly kind: 'pglite' | 'postgres';
  /** Vários comandos SQL sem parâmetros (migrações). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  /** `postgres://…` usa o driver `pg`; ausente usa PGlite. */
  databaseUrl?: string | undefined;
  /** Pasta do PGlite; `memory` = em memória. */
  dataDir: string;
}

export async function openDatabase(config: DatabaseConfig): Promise<Database> {
  if (config.databaseUrl) return openPostgres(config.databaseUrl);
  return openPglite(config.dataDir);
}

async function openPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  let db: InstanceType<typeof PGlite>;
  if (dataDir === 'memory') db = await PGlite.create();
  else {
    const dir = resolve(dataDir);
    mkdirSync(dir, { recursive: true });
    db = await PGlite.create(dir);
  }
  // PGlite tem uma conexão só: as transações ficam em fila para não se misturarem.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    kind: 'pglite',
    query: <T>(sql: string, params: unknown[] = []) => serial(async () => (await db.query<T>(sql, params)).rows),
    exec: (sql) => serial(async () => void (await db.exec(sql))),
    transaction: (fn) =>
      serial(() =>
        db.transaction((tx) =>
          fn({
            query: async <T>(sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows,
          }),
        ),
      ),
    close: () => serial(() => db.close()),
  };
}

async function openPostgres(url: string): Promise<Database> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  await pool.query('SELECT 1');
  return {
    kind: 'postgres',
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    exec: async (sql) => void (await pool.query(sql)),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[] });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
