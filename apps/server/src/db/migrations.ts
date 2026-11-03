/**
 * Migrações SQL em `apps/server/migrations/NNN_nome.sql`, aplicadas em ordem e registradas
 * em `schema_migrations` (cada uma numa transação).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from './database.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(`${dir}/${file}`, 'utf8');
    await db.transaction(async (tx) => {
      // Sem parâmetros: um comando por vez (o protocolo estendido não aceita vários).
      for (const stmt of splitSql(sql)) await tx.query(stmt);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Divide um arquivo de migração em comandos (sem suporte a `;` dentro de strings/funções). */
function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
