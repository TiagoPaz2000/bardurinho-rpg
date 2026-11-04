/**
 * Fase 7 — `npm run metrics:report`: relatório do teste externo (Markdown + HTML) com todas as
 * métricas principais do plano, pesquisa, bugs e o quadro de go/no-go.
 *
 * Duas fontes:
 *   - servidor no ar: `--server http://127.0.0.1:2567 --token <ADMIN_TOKEN>` (ou ADMIN_TOKEN no .env)
 *     — usa a API /admin (o PGlite só pode ser aberto por um processo);
 *   - banco direto (servidor parado): `--data .data/playtest` (padrão: DATA_DIR do .env ou
 *     .data/playtest) ou DATABASE_URL.
 *
 * Outras opções: `--since 2026-11-10`, `--until 2026-11-24`, `--label "texto"`,
 * `--out pasta/arquivo` (sem extensão; padrão .data/reports/relatorio-AAAA-MM-DD).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalog } from '@bardurinho/content';
import { openDatabase } from '../../apps/server/src/db/database.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { computePlaytestMetrics, renderHtml, renderMarkdown } from '../../apps/server/src/modules/analytics/playtestMetrics.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (existsSync('.env')) process.loadEnvFile('.env');

const since = opt('since') ? new Date(opt('since')!) : null;
const until = opt('until') ? new Date(`${opt('until')}${opt('until')!.length === 10 ? 'T23:59:59Z' : ''}`) : null;
const label = opt('label') ?? null;
const out = opt('out') ?? `.data/reports/relatorio-${new Date().toISOString().slice(0, 10)}`;
const token = opt('token') ?? process.env.ADMIN_TOKEN;
const serverUrl = opt('server') ?? (opt('data') ? undefined : `http://127.0.0.1:${process.env.PORT ?? 2567}`);

async function viaServer(url: string, tok: string): Promise<{ md: string; html: string } | null> {
  try {
    if (!(await fetch(`${url}/health`)).ok) return null;
  } catch {
    return null;
  }
  const q = new URLSearchParams();
  if (since) q.set('since', since.toISOString());
  if (until) q.set('until', until.toISOString());
  if (label) q.set('label', label);
  const get = async (p: string) => {
    const r = await fetch(`${url}/admin/api/${p}?${q}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
    return r.text();
  };
  return { md: await get('report.md'), html: await get('report.html') };
}

let report: { md: string; html: string } | null = null;
if (serverUrl && token) {
  report = await viaServer(serverUrl, token);
  if (report) console.log(`[relatório] dados do servidor ${serverUrl}`);
  else if (opt('server')) {
    console.error(`[relatório] servidor ${serverUrl} indisponível`);
    process.exit(1);
  }
}
if (!report) {
  const dataDir = opt('data') ?? process.env.DATA_DIR ?? '.data/playtest';
  if (!process.env.DATABASE_URL && dataDir !== 'memory' && !existsSync(dataDir)) {
    console.error(`[relatório] banco não encontrado em ${dataDir} (use --data <pasta> ou --server <url> --token <ADMIN_TOKEN>)`);
    process.exit(1);
  }
  console.log(`[relatório] lendo o banco ${process.env.DATABASE_URL ? 'DATABASE_URL' : dataDir} (o servidor precisa estar parado se for PGlite)`);
  const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL, dataDir });
  await migrate(db);
  const m = await computePlaytestMetrics(db, catalog, { since, until, label });
  await db.close();
  report = { md: renderMarkdown(m), html: renderHtml(m) };
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.md`, report.md);
writeFileSync(`${out}.html`, report.html);
console.log(`[relatório] ${out}.md e ${out}.html`);
