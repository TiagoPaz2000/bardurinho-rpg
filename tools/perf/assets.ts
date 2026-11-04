/**
 * Fase 6 — auditoria dos assets carregados pelo cliente: `npm run perf:assets`.
 *
 * Lê cada GLB de `assets/models/{characters,environment,vfx}` (glTF-Transform + decodificador
 * meshopt) e compara com os orçamentos de docs/fase-02-modelos-3d.md:
 *   personagem ≤ ~5 000 triângulos · objeto ≤ ~1 500 · peça de construção ≤ ~500 ·
 *   texturas ≤ 1024 px (hipótese do plano; tools/models/optimize.ts usa 1024).
 * Os efeitos (assets/models/vfx) não têm orçamento no plano: usa-se o de objeto (~1 500).
 * Também lista os orçamentos de partículas do código (capacidade dos presets em
 * apps/web/src/rendering/fx/particles.ts) e o total de bytes que o cliente baixa.
 *
 * Sai com código 1 com `--strict` se algum item passar do orçamento.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ImageUtils, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const BUDGET = { character: 5000, object: 1500, piece: 500, vfx: 1500, texturePx: 1024 } as const;
const GROUPS: Array<{ dir: string; kind: keyof typeof BUDGET; label: string }> = [
  { dir: 'assets/models/characters', kind: 'character', label: 'personagem' },
  { dir: 'assets/models/environment', kind: 'object', label: 'objeto (cenário)' },
  { dir: 'assets/models/vfx', kind: 'vfx', label: 'efeito' },
];

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

interface Row { file: string; group: string; kb: number; triangles: number; vertices: number; meshes: number; materials: number; textures: number; maxTexPx: number; texSizes: string; budget: number; over: string[] }
const rows: Row[] = [];
for (const g of GROUPS) {
  for (const f of readdirSync(g.dir).filter((x) => x.endsWith('.glb')).sort()) {
    const path = join(g.dir, f);
    const doc = await io.read(path);
    const root = doc.getRoot();
    let triangles = 0;
    let vertices = 0;
    // Conta por instância (nós que usam a malha), como a GPU desenha.
    const uses = new Map<unknown, number>();
    for (const n of root.listNodes()) {
      const m = n.getMesh();
      if (m) uses.set(m, (uses.get(m) ?? 0) + 1);
    }
    for (const m of root.listMeshes()) {
      const k = uses.get(m) ?? 1;
      for (const p of m.listPrimitives()) {
        const pos = p.getAttribute('POSITION');
        const idx = p.getIndices();
        vertices += (pos?.getCount() ?? 0) * k;
        if (p.getMode() === 4) triangles += ((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3) * k;
      }
    }
    const sizes: string[] = [];
    let maxTexPx = 0;
    for (const t of root.listTextures()) {
      const img = t.getImage();
      const size = img ? ImageUtils.getSize(img, t.getMimeType()) : null;
      if (size) {
        sizes.push(`${size[0]}×${size[1]}`);
        maxTexPx = Math.max(maxTexPx, size[0], size[1]);
      }
    }
    const budget = BUDGET[g.kind];
    const over: string[] = [];
    if (triangles > budget) over.push(`triângulos ${Math.round(triangles)} > ${budget}`);
    if (maxTexPx > BUDGET.texturePx) over.push(`textura ${maxTexPx} px > ${BUDGET.texturePx}`);
    rows.push({ file: path.replaceAll('\\', '/'), group: g.label, kb: Math.round(statSync(path).size / 102.4) / 10, triangles: Math.round(triangles), vertices, meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, maxTexPx, texSizes: [...new Set(sizes)].join(', '), budget, over });
  }
}

console.log('| Arquivo | Tipo | KB | Triângulos | Orçamento | Vértices | Malhas | Materiais | Texturas (px) | Situação |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.file.replace('assets/models/', '')} | ${r.group} | ${r.kb} | ${r.triangles} | ${r.budget} | ${r.vertices} | ${r.meshes} | ${r.materials} | ${r.textures ? `${r.textures} (${r.texSizes})` : '—'} | ${r.over.length ? `⚠️ ${r.over.join('; ')}` : 'ok'} |`);
}
const total = rows.reduce((a, r) => a + r.kb, 0);
console.log(`\nTotal de modelos baixados pelo cliente: ${(total / 1024).toFixed(2)} MB em ${rows.length} arquivos; ${rows.filter((r) => r.over.length).length} acima do orçamento.`);

// Orçamentos de partículas (presets do pool em particles.ts): capacidade = máximo de partículas vivas por sistema.
const src = readFileSync('apps/web/src/rendering/fx/particles.ts', 'utf8');
const presets = [...src.matchAll(/^ {2}(\w+): \{\s*\n\s*capacity: (\d+)/gm)].map((m) => ({ preset: m[1]!, capacity: Number(m[2]) }));
const caps = src.match(/MAX_[A-Z_]+ = \d+/g) ?? [];
console.log('\n| Preset de partículas | Capacidade (partículas vivas por sistema) |');
console.log('|---|---|');
for (const p of presets) console.log(`| ${p.preset} | ${p.capacity} |`);
if (caps.length) console.log(`\nLimites no código: ${caps.join(', ')}`);

// Ícones (texturas da interface).
let iconBytes = 0;
let iconFiles = 0;
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name !== 'master') walk(join(d, e.name));
    } else if (/\.(png|svg)$/.test(e.name)) {
      iconBytes += statSync(join(d, e.name)).size;
      iconFiles++;
    }
  }
};
walk('assets/icons');
console.log(`Ícones da interface (sem as imagens-mestre): ${iconFiles} arquivos, ${(iconBytes / 1048576).toFixed(2)} MB`);

if (process.argv.includes('--strict') && rows.some((r) => r.over.length)) process.exit(1);
