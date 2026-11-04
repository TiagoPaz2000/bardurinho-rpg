import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

/** Caminho servido do decodificador meshopt (ver src/rendering/loaders.ts). */
const MESHOPT_DECODER_PATH = '/vendor/meshopt_decoder.js';

/**
 * Serve o decodificador do meshoptimizer localmente (sem CDN). Os GLBs usam
 * EXT_meshopt_compression; o Babylon carrega o decodificador como script clássico
 * e espera o global `MeshoptDecoder` — o build UMD (`meshopt_decoder.cjs`) faz isso.
 */
function meshoptDecoder(): Plugin {
  // `meshopt_decoder.cjs` (UMD) não está em "exports"; fica ao lado do build ESM exportado em `./decoder`.
  const file = join(dirname(require.resolve('meshoptimizer/decoder')), 'meshopt_decoder.cjs');
  return {
    name: 'bardurinho:meshopt-decoder',
    configureServer(server) {
      server.middlewares.use(MESHOPT_DECODER_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MESHOPT_DECODER_PATH.slice(1), source: readFileSync(file) });
    },
  };
}

/**
 * Fase 7: versão do build (package.json da raiz + commit), mostrada na interface e enviada na
 * telemetria/relatórios; o build de produção também grava `build.json`.
 */
function buildInfo() {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string };
  let commit = process.env.BUILD_COMMIT ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'local';
    }
  }
  return { version: pkg.version, commit: commit || 'local', builtAt: new Date().toISOString() };
}
const BUILD = buildInfo();

function buildManifest(): Plugin {
  return {
    name: 'bardurinho:build-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify(BUILD, null, 2) });
    },
    // A arte-fonte (`assets/models/source`, ~60 MB) não é usada pelo jogo: fica fora da distribuição.
    closeBundle() {
      rmSync(fileURLToPath(new URL('./dist/models/source', import.meta.url)), { recursive: true, force: true });
    },
  };
}

// Arte-fonte fica em `assets/` na raiz do repositório; servida na raiz do cliente,
// ex.: /models/characters/mage.glb (mesma convenção do Combat Debug Lab).
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  plugins: [meshoptDecoder(), buildManifest()],
  define: { __BUILD_INFO__: JSON.stringify(BUILD) },
});
