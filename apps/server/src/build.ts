/**
 * Fase 7: versão do build (mostrada no cliente, gravada na telemetria e nos relatórios).
 * Versão = `version` do package.json da raiz; commit = `git rev-parse --short HEAD` (ou
 * `BUILD_COMMIT`, ou "local" sem git). O cliente de produção traz a própria (vite build).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BuildInfo } from '@bardurinho/protocol';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let cached: BuildInfo | null = null;

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  if (cached) return cached;
  let version = '0.0.0';
  try {
    version = (JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8')) as { version: string }).version;
  } catch {
    /* sem package.json */
  }
  let commit = env.BUILD_COMMIT ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'local';
    }
  }
  cached = { version, commit: commit || 'local', builtAt: new Date().toISOString() };
  return cached;
}
