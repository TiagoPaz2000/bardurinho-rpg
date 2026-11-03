/**
 * Otimiza os modelos-fonte (assets/models/source/**) para as versões carregadas pelo jogo.
 *
 *   npm run optimize-models            # todos
 *   npm run optimize-models -- mage    # só os que contêm "mage" no caminho
 *
 * Usa glTF-Transform `optimize`: solda vértices, simplifica a malha (meshoptimizer),
 * comprime geometria com Meshopt (EXT_meshopt_compression) e texturas em WebP
 * (EXT_texture_webp). Materiais diferentes não são fundidos (precisaria de atlas de textura).
 * O Babylon.js carrega esses arquivos, mas precisa do decodificador meshopt.
 *
 * Para conferir a forma: npx tsx tools/models/preview.ts <arquivo.glb> <saida.png>
 *
 * Os originais ficam em assets/models/source/ e não são alterados. Para cada modelo há uma
 * meta de triângulos (docs/fase-02-modelos-3d.md); a proporção e a tolerância de erro da
 * simplificação são ajustadas automaticamente até ficar abaixo da meta.
 *
 * Jobs com `geometryOnly` (malhas sem UV/material, ex.: a placa do cenário) passam antes por
 * uma simplificação própria (ver `simplifyGeometryOnly`), porque o `simplify` do CLI trava
 * nas costuras de NORMAL da malha original.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

interface Job {
  source: string;
  output: string;
  /** Meta máxima de triângulos. */
  maxTriangles: number;
  textureSize: number;
  /**
   * Malha só com POSITION/NORMAL (sem UV nem material). Descarta as normais originais,
   * solda por posição, simplifica com meshoptimizer (flag Prune) e recalcula normais com
   * ângulo de quina; depois o CLI só comprime (`--simplify false`).
   */
  geometryOnly?: { creaseAngleDeg: number };
}

const JOBS: Job[] = [
  ...['mage', 'rogue', 'warrior', 'druid'].map((c) => ({
    source: `assets/models/source/characters/${c}.glb`,
    output: `assets/models/characters/${c}.glb`,
    maxTriangles: 8000,
    textureSize: 1024,
  })),
  {
    source: 'assets/models/source/environment/ornate_circular_base_plate.glb',
    output: 'assets/models/environment/ornate_circular_base_plate.glb',
    maxTriangles: 5000,
    textureSize: 1024,
    geometryOnly: { creaseAngleDeg: 50 },
  },
];

/** Conta triângulos lendo o JSON do GLB (contagem dos acessores de índice). */
export function glbStats(path: string): { triangles: number; bytes: number; materials: number; textures: number; meshes: number } {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} não é GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    meshes?: Array<{ primitives: Array<{ indices?: number; attributes: Record<string, number>; mode?: number }> }>;
    accessors: Array<{ count: number }>;
    materials?: unknown[];
    textures?: unknown[];
  };
  let triangles = 0;
  for (const m of gltf.meshes ?? []) {
    for (const p of m.primitives) {
      if ((p.mode ?? 4) !== 4) continue;
      const count = p.indices !== undefined ? gltf.accessors[p.indices]!.count : gltf.accessors[p.attributes.POSITION!]!.count;
      triangles += count / 3;
    }
  }
  return { triangles, bytes: buf.length, materials: gltf.materials?.length ?? 0, textures: gltf.textures?.length ?? 0, meshes: gltf.meshes?.length ?? 0 };
}

function optimize(input: string, output: string, job: Job, simplify: { ratio: number; error: number } | null): void {
  execFileSync(process.execPath, [
    cli, 'optimize', input, output,
    '--compress', 'meshopt',
    '--texture-compress', 'webp',
    '--texture-size', String(job.textureSize),
    ...(simplify
      ? ['--simplify', 'true', '--simplify-ratio', String(simplify.ratio), '--simplify-error', String(simplify.error)]
      : ['--simplify', 'false']),
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Normais suaves ponderadas por área, mas sem misturar faces que formam quina (ângulo entre
 * as normais das faces > creaseAngleDeg): nas quinas o vértice é duplicado. Assim os degraus
 * ficam com aresta viva e as superfícies curvas continuam lisas.
 */
function creaseNormals(prim: Primitive, creaseAngleDeg: number): void {
  const position = prim.getAttribute('POSITION')!;
  const pos = position.getArray() as Float32Array;
  const idx = prim.getIndices()!.getArray()!;
  const triCount = idx.length / 3;
  const faceN = new Float32Array(triCount * 3); // não normalizada (módulo = 2 × área)
  const unitN = new Float32Array(triCount * 3);
  const facesOf: number[][] = Array.from({ length: pos.length / 3 }, () => []);
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceN.set([nx, ny, nz], t * 3);
    unitN.set([nx / len, ny / len, nz / len], t * 3);
    for (let k = 0; k < 3; k++) facesOf[idx[t * 3 + k]!]!.push(t);
  }
  const cos = Math.cos((creaseAngleDeg * Math.PI) / 180);
  // Malha "desoldada": 3 vértices por triângulo; o weld() depois junta os iguais.
  const outPos = new Float32Array(triCount * 9);
  const outNor = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      let nx = 0, ny = 0, nz = 0;
      for (const f of facesOf[v]!) {
        const d = unitN[t * 3]! * unitN[f * 3]! + unitN[t * 3 + 1]! * unitN[f * 3 + 1]! + unitN[t * 3 + 2]! * unitN[f * 3 + 2]!;
        if (d < cos) continue;
        nx += faceN[f * 3]!; ny += faceN[f * 3 + 1]!; nz += faceN[f * 3 + 2]!;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = (t * 3 + k) * 3;
      outPos.set(pos.subarray(v * 3, v * 3 + 3), o);
      outNor.set([nx / len, ny / len, nz / len], o);
    }
  }
  position.setArray(outPos);
  prim.getAttribute('NORMAL')!.setArray(outNor);
  prim.setIndices(null);
}

/**
 * Pré-simplificação de malhas sem UV/material. O `simplify` do CLI parava em ~88 mil
 * triângulos na placa porque as normais originais têm costuras (vértices duplicados com
 * normais diferentes) que o meshoptimizer não colapsa. Sem as normais, a solda por posição
 * deixa a malha contínua e o simplificador chega à meta com erro pequeno (~0,5% do tamanho).
 * A flag Prune remove pedacinhos soltos que ficariam abaixo do erro.
 */
async function simplifyGeometryOnly(job: Job, input: string, output: string): Promise<{ error: number; vertices: number }> {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.getAttribute('NORMAL')?.dispose();
  }
  await doc.transform(weld());
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const totalTris = prims.reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  // Margem de 4% para a meta: o CLI pode reordenar, mas não cria triângulos.
  const target = job.maxTriangles * 0.96;
  let maxError = 0;
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')!.getArray() as Float32Array;
    const indices = new Uint32Array(prim.getIndices()!.getArray()!);
    const targetIndexCount = Math.floor((target * (indices.length / 3)) / totalTris) * 3;
    // Erro relativo (fração do tamanho da malha) alto o bastante para não limitar a meta.
    const [result, error] = MeshoptSimplifier.simplify(indices, pos, 3, targetIndexCount, 0.05, ['Prune']);
    maxError = Math.max(maxError, error);
    prim.getIndices()!.setArray(result);
    compactPrimitive(prim);
    const position = prim.getAttribute('POSITION')!;
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(position.getBuffer()).setArray(new Float32Array(0)));
    creaseNormals(prim, job.geometryOnly!.creaseAngleDeg);
  }
  await doc.transform(weld(), prune());
  await io.write(output, doc);
  const vertices = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getAttribute('POSITION')!.getCount(), 0);
  return { error: maxError, vertices };
}

const filter = process.argv[2];
const reportPath = join(root, 'assets/models/optimization-report.json');
// Com filtro, só as entradas dos modelos processados mudam; as demais são mantidas.
const report: Record<string, unknown> = filter && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
for (const job of JOBS.filter((j) => !filter || j.source.includes(filter))) {
  if (!existsSync(join(root, job.source))) {
    console.warn(`  ! fonte ausente: ${job.source}`);
    continue;
  }
  mkdirSync(dirname(join(root, job.output)), { recursive: true });
  const before = glbStats(join(root, job.source));
  if (job.geometryOnly) {
    const tmp = mkdtempSync(join(tmpdir(), 'optimize-models-'));
    try {
      const simplified = join(tmp, 'simplified.glb');
      const pre = await simplifyGeometryOnly(job, join(root, job.source), simplified);
      optimize(simplified, join(root, job.output), job, null);
      const after = glbStats(join(root, job.output));
      if (after.triangles > job.maxTriangles) throw new Error(`${job.output}: ${after.triangles} triângulos > meta ${job.maxTriangles}`);
      console.log(`  ✓ ${relative(root, job.output)}: ${before.triangles.toLocaleString('pt-BR')} → ${after.triangles.toLocaleString('pt-BR')} triângulos, ` +
        `${(before.bytes / 1e6).toFixed(2)} MB → ${(after.bytes / 1e6).toFixed(2)} MB (simplificação só de geometria, erro ${(pre.error * 100).toFixed(2)}%)`);
      report[job.output] = {
        source: job.source,
        method: 'geometry-only: drop NORMAL, weld, meshoptimizer simplify (Prune), crease normals, CLI optimize --simplify false',
        simplifyError: Number(pre.error.toFixed(5)),
        creaseAngleDeg: job.geometryOnly.creaseAngleDeg,
        before,
        after: { ...after, vertices: pre.vertices },
      };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    continue;
  }
  // Primeira estimativa pela proporção de triângulos; reduz até atingir a meta.
  let ratio = Math.min(1, (job.maxTriangles / before.triangles) * 0.9);
  // Tolerância de erro (fração do tamanho da malha): começa em 1% e dobra se a meta não for atingida.
  let error = 0.01;
  let after = before;
  for (let attempt = 0; attempt < 8; attempt++) {
    optimize(join(root, job.source), join(root, job.output), job, { ratio, error });
    after = glbStats(join(root, job.output));
    if (after.triangles <= job.maxTriangles) break;
    ratio *= (job.maxTriangles / after.triangles) * 0.9;
    error = Math.min(error * 2, 0.2);
  }
  const line = `${relative(root, job.output)}: ${before.triangles.toLocaleString('pt-BR')} → ${after.triangles.toLocaleString('pt-BR')} triângulos, ` +
    `${(before.bytes / 1e6).toFixed(2)} MB → ${(after.bytes / 1e6).toFixed(2)} MB, materiais ${before.materials} → ${after.materials}`;
  console.log(`  ✓ ${line}`);
  report[job.output] = { source: job.source, ratio: Number(ratio.toFixed(5)), simplifyError: error, before, after };
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Relatório: assets/models/optimization-report.json (${statSync(reportPath).size} bytes)`);
