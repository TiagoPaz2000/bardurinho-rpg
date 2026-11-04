/**
 * Fase 7: versão deste build do cliente (injetada pelo vite.config.ts: package.json da raiz +
 * commit). Fora do Vite (testes em Node) vale "dev".
 */
import { formatBuild, type BuildInfo } from '@bardurinho/protocol';

declare const __BUILD_INFO__: BuildInfo | undefined;

export const BUILD: BuildInfo = typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__ ? __BUILD_INFO__ : { version: 'dev', commit: 'local', builtAt: new Date(0).toISOString() };
export const BUILD_LABEL = formatBuild(BUILD);
/** Build de produção (vite build): sem atalhos de depuração na interface. */
export const IS_PROD = ((): boolean => {
  try {
    // O Vite troca `import.meta.env.PROD` por um literal; no Node `env` não existe (cai no catch).
    return import.meta.env.PROD === true;
  } catch {
    return false;
  }
})();
