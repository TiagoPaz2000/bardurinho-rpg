/**
 * Fase 7 — `npm run playtest:invites -- --count 10 --uses 1 --label "grupo 1"`: gera códigos de
 * convite para o grupo controlado (e lista os existentes com `--list`).
 *
 * Com o servidor no ar usa a API /admin (`--server`, padrão http://127.0.0.1:PORT; token em
 * `--token` ou ADMIN_TOKEN no .env); com o servidor parado grava direto no banco (`--data`,
 * padrão DATA_DIR do .env ou .data/playtest).
 */
import { existsSync } from 'node:fs';
import { openDatabase } from '../../apps/server/src/db/database.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { PlaytestRepository } from '../../apps/server/src/db/playtest.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (existsSync('.env')) process.loadEnvFile('.env');
const list = argv.includes('--list');
const count = Math.max(1, Math.min(200, Number(opt('count') ?? 10)));
const uses = Math.max(1, Number(opt('uses') ?? 1));
const label = opt('label') ?? null;
const token = opt('token') ?? process.env.ADMIN_TOKEN;
const server = opt('server') ?? `http://127.0.0.1:${process.env.PORT ?? 2567}`;

type Row = { code: string; uses: number; maxUses: number; disabled: boolean; label: string | null };
const print = (rows: Row[]) => {
  for (const r of rows) console.log(`${r.code}\t${r.uses}/${r.maxUses}${r.disabled ? '\t(desativado)' : ''}${r.label ? `\t${r.label}` : ''}`);
};

let online = false;
if (!opt('data') && token) {
  try {
    online = (await fetch(`${server}/health`)).ok;
  } catch {
    online = false;
  }
}
if (online) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (list) print((await (await fetch(`${server}/admin/api/invites`, { headers })).json()) as Row[]);
  else {
    const r = await fetch(`${server}/admin/api/invites`, { method: 'POST', headers, body: JSON.stringify({ count, maxUses: uses, label }) });
    if (!r.ok) throw new Error(`servidor: ${r.status} ${await r.text()}`);
    console.log(((await r.json()) as { codes: string[] }).codes.join('\n'));
  }
} else {
  const dataDir = opt('data') ?? process.env.DATA_DIR ?? '.data/playtest';
  const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL, dataDir });
  await migrate(db);
  const repo = new PlaytestRepository(db);
  if (list) print(await repo.invites());
  else console.log((await repo.createInvites(count, uses, label)).join('\n'));
  await db.close();
}
