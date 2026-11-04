/**
 * Worker do lote (Fase 6): recebe especificações de partidas e devolve os resultados.
 *
 * `BALANCE_PATCH` (JSON, opcional) altera o catálogo só neste processo, para testar variações
 * de balanceamento sem editar o conteúdo: `{"items":{"weapon.iron_sword":{"damage":"1d8+11"}},
 * "classes":{"mage":{"hp":86}},"abilities":{"druid.root":{"cost":{"ap":1,"focus":2}}}}`
 * (mescla profunda; listas são substituídas).
 */
import { parentPort } from 'node:worker_threads';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { WEIGHTS } from '@bardurinho/ai';
import { playMatch, type MatchSpec } from './match.js';

function merge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}
// `AI_PATCH` (JSON, opcional): mesmo esquema para os pesos do bot (`WEIGHTS` de packages/ai/src/evaluate.ts).
if (process.env.AI_PATCH) merge(WEIGHTS as unknown as Record<string, unknown>, JSON.parse(process.env.AI_PATCH) as Record<string, unknown>);
if (process.env.BALANCE_PATCH) merge(catalog as unknown as Record<string, unknown>, JSON.parse(process.env.BALANCE_PATCH) as Record<string, unknown>);

parentPort!.on('message', (msg: { id: number; spec: MatchSpec } | 'exit') => {
  if (msg === 'exit') return process.exit(0);
  parentPort!.postMessage({ id: msg.id, outcome: playMatch(msg.spec, catalog, patioDasRuinas) });
});
