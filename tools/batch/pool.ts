/** Fase 6: executa partidas em paralelo (worker_threads, um worker por núcleo). */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { MatchOutcome, MatchSpec } from './match.js';

export async function runPool(specs: MatchSpec[], opts: { workers?: number; onResult?: (o: MatchOutcome, done: number) => void } = {}): Promise<MatchOutcome[]> {
  const n = Math.max(1, Math.min(opts.workers ?? Number(process.env.WORKERS ?? availableParallelism()), specs.length));
  const out: MatchOutcome[] = new Array(specs.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, () =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
        const feed = () => {
          if (next >= specs.length) {
            w.postMessage('exit');
            return;
          }
          const id = next++;
          w.postMessage({ id, spec: specs[id] });
        };
        w.on('message', (m: { id: number; outcome: MatchOutcome }) => {
          out[m.id] = m.outcome;
          done++;
          opts.onResult?.(m.outcome, done);
          feed();
        });
        w.on('error', reject);
        w.on('exit', () => resolve());
        feed();
      }),
    ),
  );
  return out;
}
