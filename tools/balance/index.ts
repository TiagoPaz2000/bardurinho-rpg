/**
 * Fase 6 — balanceamento: `npm run balance [-- N [N2v2]]`.
 *
 * Bot difícil × bot difícil no Pátio das Ruínas, dados aleatórios, sem acessório, Poção de
 * vida + Poção de Foco. 1 × 1: os 16 pares ordenados de classes (A × B), N partidas cada
 * (padrão 100 → 200 por par não ordenado, metade de cada lado). 2 × 2: N2v2 partidas com
 * composições sorteadas (padrão 160). Relatório: taxa de vitória por classe (espelhos fora;
 * empate = meia vitória), matriz de confrontos, lado A × B, rodadas, motivos de término, uso de
 * habilidades/armas/itens por partida, dano e acerto por classe, interações com o ambiente.
 * Saída: `tools/balance/out/<LABEL>.json` e `.md` (LABEL padrão: `atual`; DIFF=hard; SEED=1).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BotDifficulty } from '@bardurinho/ai';
import type { MatchOutcome, MatchSpec } from '../batch/match.js';
import { runPool } from '../batch/pool.js';

const N = Number(process.argv[2] ?? 100);
const N2 = Number(process.argv[3] ?? 160);
const LABEL = process.env.LABEL ?? 'atual';
const DIFF = (process.env.DIFF ?? 'hard') as BotDifficulty;
const SEED = Number(process.env.SEED ?? 1);
const CLASSES = ['warrior', 'mage', 'rogue', 'druid'];
const NAMES: Record<string, string> = { warrior: 'Guerreiro', mage: 'Mago', rogue: 'Ladino', druid: 'Druida' };

/** Sorteio determinístico simples (composições 2 × 2). */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const specs: MatchSpec[] = [];
let seed = SEED;
for (const a of CLASSES) for (const b of CLASSES) for (let i = 0; i < N; i++) specs.push({ seed: seed++, A: { difficulty: DIFF, classes: [a] }, B: { difficulty: DIFF, classes: [b] } });
const pickRng = rng(SEED * 977 + 3);
const pick = () => CLASSES[Math.floor(pickRng() * 4)]!;
seed = 900000 + SEED;
for (let i = 0; i < N2; i++) specs.push({ seed: seed++, A: { difficulty: DIFF, classes: [pick(), pick()] }, B: { difficulty: DIFF, classes: [pick(), pick()] } });

const t0 = Date.now();
const all = await runPool(specs, {
  onResult: (_o, done) => {
    if (done % 200 === 0) console.log(`  ${done}/${specs.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  },
});
const seconds = (Date.now() - t0) / 1000;
const duel = all.filter((r) => r.A.length === 1);
const teams = all.filter((r) => r.A.length === 2);

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)} %` : '—');
const score = (r: MatchOutcome, side: 'A' | 'B') => (r.winner === side ? 1 : r.winner === 'draw' ? 0.5 : 0);

// --- Por classe (1 × 1, sem espelhos) -----------------------------------------------------------
const perClass: Record<string, { games: number; wins: number; draws: number; losses: number; score: number }> = {};
const matrix: Record<string, Record<string, { games: number; score: number; rounds: number }>> = {};
for (const c of CLASSES) {
  perClass[c] = { games: 0, wins: 0, draws: 0, losses: 0, score: 0 };
  matrix[c] = Object.fromEntries(CLASSES.map((d) => [d, { games: 0, score: 0, rounds: 0 }]));
}
for (const r of duel) {
  for (const side of ['A', 'B'] as const) {
    const me = (side === 'A' ? r.A : r.B)[0]!;
    const op = (side === 'A' ? r.B : r.A)[0]!;
    const m = matrix[me]![op]!;
    m.games++;
    m.score += score(r, side);
    m.rounds += r.rounds;
    if (me === op) continue;
    const p = perClass[me]!;
    p.games++;
    p.score += score(r, side);
    if (r.winner === side) p.wins++;
    else if (r.winner === 'draw') p.draws++;
    else p.losses++;
  }
}
const sideA = duel.reduce((s, r) => s + score(r, 'A'), 0) / duel.length;

// --- 2 × 2: por classe presente numa equipe e ausente na outra --------------------------------------
const team2: Record<string, { games: number; score: number }> = Object.fromEntries(CLASSES.map((c) => [c, { games: 0, score: 0 }]));
const comps: Record<string, { games: number; score: number }> = {};
for (const r of teams) {
  for (const side of ['A', 'B'] as const) {
    const mine = side === 'A' ? r.A : r.B;
    const theirs = side === 'A' ? r.B : r.A;
    for (const c of new Set(mine)) {
      if (theirs.includes(c)) continue;
      team2[c]!.games++;
      team2[c]!.score += score(r, side);
    }
    const key = [...mine].sort().map((c) => NAMES[c]).join('+');
    comps[key] ??= { games: 0, score: 0 };
    comps[key]!.games++;
    comps[key]!.score += score(r, side);
  }
}

// --- Uso, dano, ambiente -------------------------------------------------------------------------
const usage: Record<string, Record<string, number>> = {};
const unitGames: Record<string, number> = {};
const dmg: Record<string, { dealt: number; taken: number; healing: number; attacks: number; hits: number }> = {};
const env: Record<string, number> = {};
const reasons: Record<string, number> = {};
for (const r of duel) {
  for (const c of [...r.A, ...r.B]) unitGames[c] = (unitGames[c] ?? 0) + 1;
  for (const [c, u] of Object.entries(r.usage)) for (const [k, n] of Object.entries(u)) ((usage[c] ??= {})[k] = (usage[c]![k] ?? 0) + n);
  for (const [c, s] of Object.entries(r.stats)) {
    const d = (dmg[c] ??= { dealt: 0, taken: 0, healing: 0, attacks: 0, hits: 0 });
    d.dealt += s.damageDealt;
    d.taken += s.damageTaken;
    d.healing += s.healing;
    d.attacks += s.attacks;
    d.hits += s.hits;
  }
  for (const [k, n] of Object.entries(r.env)) env[k] = (env[k] ?? 0) + n;
  const kind = r.winner === 'draw' ? 'empate' : r.winner === 'none' ? 'sem resultado' : 'vitória';
  const k = `${kind} (${r.reason})`;
  reasons[k] = (reasons[k] ?? 0) + 1;
}

// --- Markdown -------------------------------------------------------------------------------------
const md: string[] = [];
md.push(`### ${LABEL} — ${duel.length} partidas 1 × 1 (${N} por par ordenado) + ${teams.length} partidas 2 × 2, bot ${DIFF}, ${seconds.toFixed(0)} s`);
md.push('', '| Classe | Partidas 1 × 1 (sem espelho) | Vitórias | Empates | Derrotas | Taxa (empate = ½) | 2 × 2 (partidas) |', '|---|---|---|---|---|---|---|');
for (const c of CLASSES) {
  const p = perClass[c]!;
  const t = team2[c]!;
  md.push(`| ${NAMES[c]} | ${p.games} | ${p.wins} | ${p.draws} | ${p.losses} | **${pct(p.score / p.games)}** | ${t.games ? `${pct(t.score / t.games)} (${t.games})` : '—'} |`);
}
md.push('', 'Confrontos 1 × 1 (taxa da linha contra a coluna, os dois lados somados; rodadas médias entre parênteses):', '', `| | ${CLASSES.map((c) => NAMES[c]).join(' | ')} |`, `|---|${CLASSES.map(() => '---').join('|')}|`);
for (const a of CLASSES) {
  const cells = CLASSES.map((b) => {
    const m = matrix[a]![b]!;
    return `${pct(m.score / m.games)} (${(m.rounds / m.games).toFixed(1)})`;
  });
  md.push(`| **${NAMES[a]}** | ${cells.join(' | ')} |`);
}
const avgRounds = duel.reduce((s, r) => s + r.rounds, 0) / duel.length;
md.push('', `Equipe A: ${pct(sideA)} · rodadas médias ${avgRounds.toFixed(1)} · término: ${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(', ')} · comandos recusados pelo core ${duel.reduce((s, r) => s + r.rejected, 0)} de ${duel.reduce((s, r) => s + r.commands, 0)}`);
md.push('', 'Dano e acerto por classe (média por personagem e partida 1 × 1):', '', '| Classe | Dano causado | Dano recebido | Cura | Jogadas de ataque | Acerto |', '|---|---|---|---|---|---|');
for (const c of CLASSES) {
  const d = dmg[c] ?? { dealt: 0, taken: 0, healing: 0, attacks: 0, hits: 0 };
  const g = unitGames[c] ?? 1;
  md.push(`| ${NAMES[c]} | ${(d.dealt / g).toFixed(1)} | ${(d.taken / g).toFixed(1)} | ${(d.healing / g).toFixed(1)} | ${(d.attacks / g).toFixed(1)} | ${pct(d.hits / Math.max(1, d.attacks))} |`);
}
md.push('', 'Uso por personagem e partida (1 × 1):', '');
for (const c of CLASSES) {
  const g = unitGames[c] ?? 1;
  const list = Object.entries(usage[c] ?? {})
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${k.replace(/^(USE_ABILITY|BASIC_ATTACK|USE_ITEM|INTERACT):/, '')} ${(n / g).toFixed(2)}`);
  md.push(`- **${NAMES[c]}**: ${list.join(' · ')}`);
}
md.push('', `Ambiente (média por partida 1 × 1): ${Object.entries(env).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${(n / duel.length).toFixed(2)}`).join(' · ')}`);
if (teams.length) {
  const list = Object.entries(comps)
    .sort((x, y) => y[1].games - x[1].games)
    .map(([k, v]) => `${k} ${pct(v.score / v.games)} (${v.games})`);
  md.push('', `Composições 2 × 2 (taxa, partidas; equipe A ${pct(teams.reduce((s, r) => s + score(r, 'A'), 0) / teams.length)}, rodadas médias ${(teams.reduce((s, r) => s + r.rounds, 0) / teams.length).toFixed(1)}): ${list.join(' · ')}`);
}

mkdirSync('tools/balance/out', { recursive: true });
writeFileSync(`tools/balance/out/${LABEL}.md`, md.join('\n') + '\n');
const outcomes = all.map(({ usage: _u, stats: _s, env: _e, violations, ...r }) => ({ ...r, violations: violations.length }));
writeFileSync(`tools/balance/out/${LABEL}.json`, JSON.stringify({ label: LABEL, N, N2, difficulty: DIFF, seconds, perClass, matrix, team2, comps, sideA, usage, unitGames, dmg, env, reasons, outcomes }, null, 2));
console.log(md.join('\n'));
