/**
 * Gera screenshots de todos os cenários JSON em tests/output/<categoria>/<nome>/
 * e uma galeria estática em tests/output/index.html.
 *
 * Uso: npm run screenshots [-- <filtro>]   (filtro = trecho do caminho, ex.: "surfaces")
 */
import { relative } from 'node:path';
import { catalog } from '@bardurinho/content';
import { OUTPUT_ROOT, findScenarioDirs, generateScenarioScreenshots, scenarioName, writeGallery } from '../../tests/screenshots/scenarioShots.js';

const filter = process.argv[2];
const dirs = findScenarioDirs().filter((d) => !filter || scenarioName(d).includes(filter));
let failed = 0;
for (const dir of dirs) {
  const name = scenarioName(dir);
  try {
    const m = generateScenarioScreenshots(catalog, dir);
    const rej = m.rejected.length ? ` (${m.rejected.length} comando(s) rejeitado(s))` : '';
    console.log(`  ✓ ${name}: ${m.shots.length} imagens${rej}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err instanceof Error ? err.stack : String(err)}`);
  }
}
const index = writeGallery();
console.log(`Galeria: ${relative(process.cwd(), index)} (${dirs.length} cenário(s) em ${relative(process.cwd(), OUTPUT_ROOT)})`);
if (failed) process.exit(1);
