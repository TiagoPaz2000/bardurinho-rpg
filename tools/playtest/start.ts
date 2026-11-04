/**
 * Fase 7 — sobe o jogo para o teste externo num endereço só (`npm run start:prod`):
 *
 *   1. lê `.env` (se existir; modelo em `.env.example`);
 *   2. força o modo de produção (`NODE_ENV=production`, `GAME_DEV=0`: sem /debug, sem contas
 *      de desenvolvimento, sem semente/turno escolhidos pelo cliente);
 *   3. gera o build de produção do cliente (`vite build`) se ele não existir, for de outro
 *      commit ou com `--build`;
 *   4. sobe o servidor de jogo servindo o cliente na mesma porta e mostra os endereços da rede local.
 *
 * Opções: `--build` (refaz o cliente), `--no-build` (usa o que houver).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(ROOT);
const args = new Set(process.argv.slice(2));

if (existsSync('.env')) {
  process.loadEnvFile('.env');
  console.log('[playtest] configuração lida de .env');
}
process.env.NODE_ENV = 'production';
process.env.GAME_DEV = '0';
process.env.HOST ??= '0.0.0.0';
process.env.PORT ??= '2567';
process.env.DATA_DIR ??= '.data/playtest';

const DIST = 'apps/web/dist';
const commit = (() => {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : process.env.BUILD_COMMIT ?? 'local';
})();
let builtCommit: string | null = null;
try {
  builtCommit = (JSON.parse(readFileSync(`${DIST}/build.json`, 'utf8')) as { commit: string }).commit;
} catch {
  /* sem build */
}
const needBuild = !args.has('--no-build') && (args.has('--build') || !existsSync(`${DIST}/index.html`) || builtCommit !== commit);
if (needBuild) {
  console.log(`[playtest] gerando o cliente de produção (vite build; ~1 min)${builtCommit ? ` — build anterior: ${builtCommit}, atual: ${commit}` : ''}…`);
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: 'apps/web', stdio: 'inherit', env: { ...process.env, BUILD_COMMIT: commit } });
  if (r.status !== 0) {
    console.error('[playtest] falha no build do cliente');
    process.exit(1);
  }
}
process.env.STATIC_DIR ??= DIST;

const port = process.env.PORT;
const addrs = Object.values(networkInterfaces())
  .flat()
  .filter((a): a is NonNullable<typeof a> => !!a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a.address}:${port}/`);
console.log(`[playtest] nesta máquina: http://127.0.0.1:${port}/`);
if (process.env.HOST === '0.0.0.0' && addrs.length) console.log(`[playtest] na rede local: ${addrs.join('  ')}`);
console.log('[playtest] painel de métricas: /admin (token abaixo ou ADMIN_TOKEN do .env) · relatório: npm run metrics:report');

await import('../../apps/server/src/main.js');
