/**
 * Fase 6 — níveis do bot em lote (paralelo): `npm run balance:difficulty [-- N [pares]]`.
 * Para cada par de dificuldades (padrão `hard:normal,hard:easy,normal:easy`), N partidas
 * cobrindo os 16 pares de classes, com os lados alternados. Mostra vitórias de cada nível.
 */
import type { BotDifficulty } from '@bardurinho/ai';
import type { MatchSpec } from '../batch/match.js';
import { runPool } from '../batch/pool.js';

const N = Number(process.argv[2] ?? 160);
const pairs = (process.argv[3] ?? 'hard:normal,hard:easy,normal:easy').split(',').map((p) => p.split(':') as [BotDifficulty, BotDifficulty]);
const CLASSES = ['warrior', 'mage', 'rogue', 'druid'];
const SEED = Number(process.env.SEED ?? 3000);

for (const [x, y] of pairs) {
  const specs: MatchSpec[] = [];
  for (let i = 0; i < N; i++) {
    const swap = i % 2 === 1;
    const ca = CLASSES[Math.floor(i / 2) % 4]!;
    const cb = CLASSES[Math.floor(i / 8) % 4]!;
    specs.push({ seed: SEED + i, A: { difficulty: swap ? y : x, classes: [ca] }, B: { difficulty: swap ? x : y, classes: [cb] } });
  }
  const t0 = Date.now();
  const res = await runPool(specs);
  let wx = 0;
  let wy = 0;
  let draws = 0;
  res.forEach((r, i) => {
    const swap = i % 2 === 1;
    if (r.winner === 'draw' || r.winner === 'none') draws++;
    else if ((r.winner === 'A') !== swap) wx++;
    else wy++;
  });
  console.log(`${x} × ${y}: ${N} partidas → ${x} ${wx} (${((100 * (wx + draws / 2)) / N).toFixed(1)} %) · ${y} ${wy} · empates ${draws} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
