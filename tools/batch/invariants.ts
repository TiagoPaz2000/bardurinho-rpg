/**
 * Fase 6 — lote de invariantes: `npm run batch:invariants [-- N]` (padrão 2000 partidas).
 *
 * Partidas bot × bot pelo core oficial (dados aleatórios, semente por partida): os 16 pares
 * de classes 1 × 1 com dificuldades variadas e ~20 % de partidas 2 × 2. A cada comando aceito
 * confere os invariantes (`checkState`/`checkProjection` em tools/batch/match.ts): sem exceção,
 * PV em [0, máx], PA/PM/Foco em [0, máx], nenhuma unidade viva em célula bloqueada ou dividindo
 * célula, personagem da vez vivo, projeção sem inimigo oculto nem semente. No fim: a partida
 * terminou com resultado dentro do limite de rodadas; uma amostra é repetida com a mesma semente
 * e o hash do estado final tem de ser igual (determinismo). Sai com código 1 se algo falhar.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import type { BotDifficulty } from '@bardurinho/ai';
import type { MatchSpec } from './match.js';
import { runPool } from './pool.js';

const N = Number(process.argv[2] ?? 2000);
const CLASSES = ['warrior', 'mage', 'rogue', 'druid'];
const DIFFS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const BASE_SEED = Number(process.env.SEED ?? 50000);

const specs: MatchSpec[] = [];
for (let i = 0; i < N; i++) {
  const seed = BASE_SEED + i;
  const da = DIFFS[(i * 7) % 3]!;
  const db = DIFFS[Math.floor(i / 3) % 3]!;
  if (i % 5 === 4) {
    const pick = (k: number) => CLASSES[(seed * 31 + k * 17 + Math.floor(seed / 4)) % 4]!;
    specs.push({ seed, A: { difficulty: da, classes: [pick(1), pick(2)] }, B: { difficulty: db, classes: [pick(3), pick(5)] }, check: true });
  } else {
    specs.push({ seed, A: { difficulty: da, classes: [CLASSES[i % 4]!] }, B: { difficulty: db, classes: [CLASSES[Math.floor(i / 4) % 4]!] }, check: true });
  }
}
const step = Math.max(1, Math.min(20, Math.floor(N / 16)));
const sample = specs.filter((_, i) => i % step === 0);

const t0 = Date.now();
const results = await runPool(specs, {
  onResult: (_o, done) => {
    if (done % 200 === 0) console.log(`  ${done}/${N} partidas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  },
});
const replays = await runPool(sample);
const elapsed = (Date.now() - t0) / 1000;

const problems: string[] = [];
for (const r of results) for (const v of r.violations) problems.push(`semente ${r.seed} [${r.A.join('+')} × ${r.B.join('+')}]: ${v}`);
const byHash = new Map(results.map((r) => [r.seed, r.hash]));
let nondet = 0;
for (const r of replays) {
  if (byHash.get(r.seed) !== r.hash) {
    nondet++;
    problems.push(`semente ${r.seed}: NÃO DETERMINÍSTICA (hash ${byHash.get(r.seed)} × ${r.hash})`);
  }
}
const count = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length;
const commands = results.reduce((s, r) => s + r.commands, 0);
const rejected = results.reduce((s, r) => s + r.rejected, 0);
const maxRounds = Math.max(...results.map((r) => r.rounds));
const summary = {
  matches: N,
  duel: count((r) => r.A.length === 1),
  teams2v2: count((r) => r.A.length === 2),
  winsA: count((r) => r.winner === 'A'),
  winsB: count((r) => r.winner === 'B'),
  draws: count((r) => r.winner === 'draw'),
  noResult: count((r) => r.winner === 'none'),
  avgRounds: +(results.reduce((s, r) => s + r.rounds, 0) / N).toFixed(2),
  maxRounds,
  commands,
  rejectedByCore: rejected,
  determinismSample: replays.length,
  nondeterministic: nondet,
  violations: problems.length,
  seconds: +elapsed.toFixed(1),
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync('tools/batch/out', { recursive: true });
writeFileSync('tools/batch/out/invariants.json', JSON.stringify({ summary, problems: problems.slice(0, 500) }, null, 2));
if (problems.length) {
  console.log(`\n${problems.length} problema(s):`);
  for (const p of problems.slice(0, 40)) console.log('  ' + p.split('\n')[0]);
  process.exit(1);
}
console.log('OK: nenhum invariante violado.');
