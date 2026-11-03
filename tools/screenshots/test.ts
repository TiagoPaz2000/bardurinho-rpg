/**
 * `npm run test:screenshots`: roda os testes de cenário com SCREENSHOTS=1 (multiplataforma,
 * sem depender da sintaxe `VAR=1 cmd` do shell). Argumentos extras vão para o vitest.
 */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'tests/scenarios', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SCREENSHOTS: '1' },
});
process.exit(r.status ?? 1);
