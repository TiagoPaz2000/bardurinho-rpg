/**
 * Simulação em lote bot × bot (Fase 5): `npm run bots:sim [-- partidas]`.
 * Cada partida alterna classes e lados; imprime vitórias por dificuldade, empates, rodadas
 * médias, comandos recusados pelo core oficial e tempo por decisão.
 */
import { catalog, patioDasRuinas, DEFAULT_CONSUMABLES } from '@bardurinho/content';
import { runBotMatch, type BotDifficulty } from '@bardurinho/ai';

const N = Number(process.argv[2] ?? 20);
const pairs: Array<[BotDifficulty, BotDifficulty]> = (process.argv[3] ?? 'hard:easy,normal:easy,hard:normal')
  .split(',')
  .map((p) => p.split(':') as [BotDifficulty, BotDifficulty]);
const classes = ['warrior', 'mage', 'rogue', 'druid'];
for (const [x, y] of pairs) {
  const wins: Record<string, number> = { [x]: 0, [y]: 0, draw: 0 };
  let rounds = 0;
  let commands = 0;
  let rejected = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const swap = i % 2 === 1;
    const ca = classes[i % 4]!;
    const cb = classes[(i + 1 + Math.floor(i / 4)) % 4]!;
    const A = { difficulty: swap ? y : x, character: { classId: ca, consumables: [...DEFAULT_CONSUMABLES] } };
    const B = { difficulty: swap ? x : y, character: { classId: cb, consumables: [...DEFAULT_CONSUMABLES] } };
    const r = runBotMatch({ catalog, map: patioDasRuinas, seed: 1000 + i, A, B });
    rounds += r.rounds;
    commands += r.commands;
    rejected += r.rejected;
    const res = r.result;
    if (process.env.VERBOSE) console.log(`  seed ${1000 + i} A=${A.difficulty}/${ca} B=${B.difficulty}/${cb} → ${JSON.stringify(res)} r${r.rounds}`);
    if (!res || res.kind === 'draw') wins.draw!++;
    else {
      const d = res.winnerTeam === 'A' ? A.difficulty : B.difficulty;
      wins[d === x && d === y ? x : d]!++;
    }
  }
  const ms = Date.now() - t0;
  console.log(`${x} × ${y}: ${N} partidas → ${x} ${wins[x]} · ${y} ${wins[y]} · empates ${wins.draw} | rodadas médias ${(rounds / N).toFixed(1)} | comandos ${commands} (recusados ${rejected}) | ${(ms / commands).toFixed(1)} ms/comando, ${(ms / 1000).toFixed(1)} s`);
}
