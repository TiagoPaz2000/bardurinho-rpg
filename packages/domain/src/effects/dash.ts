/**
 * Investida: deslocamento até uma célula adjacente ao alvo, seguido de ataque (seção 4).
 *
 * - Percurso de até N PM, com o mesmo custo de terreno do movimento comum.
 * - Não atravessa portas fechadas, personagens nem escadas.
 * - Não desconta os PM normais.
 * - As superfícies do caminho se aplicam normalmente; se o atacante morrer, o ataque não ocorre.
 *
 * `planDash` é usado na validação (antes de gastar recursos) e na execução, para que
 * as duas etapas escolham exatamente o mesmo caminho.
 */
import { distance, orthogonalNeighbors, sameCoord } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import { findPath } from '../map/pathfinding.js';
import type { Catalog } from '../rules/definitions.js';
import { hasStatusFlag, isCellFree } from '../state/queries.js';
import type { GameState, Unit } from '../state/types.js';
import type { CommandError } from '../commands/types.js';
import { emit, type ResolutionContext } from '../state/context.js';
import { exposeUnitToSurface } from './surfaces.js';

export interface DashPlan {
  path: Coord[];
  stepCosts: number[];
  cost: number;
}

export function planDash(
  state: GameState,
  catalog: Catalog,
  actor: Unit,
  target: Coord,
  maxCost: number,
): { ok: true; plan: DashPlan } | { ok: false; error: CommandError } {
  if (actor.pos.floor !== target.floor) return { ok: false, error: { code: 'DIFFERENT_FLOOR', message: 'O alvo precisa estar no mesmo andar' } };
  // Já adjacente: ataca sem se deslocar.
  if (distance(actor.pos, target) === 1) return { ok: true, plan: { path: [actor.pos], stepCosts: [], cost: 0 } };
  if (actor.flags.canMove === false) return { ok: false, error: { code: 'CANNOT_MOVE', message: `${actor.id} não pode se mover` } };
  if (hasStatusFlag(state, catalog, actor, 'rooted')) return { ok: false, error: { code: 'ROOTED', message: `${actor.id} está enraizado` } };

  let best: DashPlan | null = null;
  // Ordem fixa dos vizinhos = desempate determinístico.
  for (const n of orthogonalNeighbors(target)) {
    if (!sameCoord(n, actor.pos) && !isCellFree(state, catalog, n)) continue;
    const p = findPath(state, catalog, actor.pos, n, { maxCost, allowConnections: false });
    if (p && (!best || p.cost < best.cost)) best = { path: p.path, stepCosts: p.stepCosts, cost: p.cost };
  }
  if (!best) return { ok: false, error: { code: 'NO_PATH', message: `Sem caminho de até ${maxCost} PM até o alvo` } };
  return { ok: true, plan: best };
}

/** Executa o percurso sem gastar PM. Retorna false se o atacante morreu no caminho. */
export function executeDash(ctx: ResolutionContext, actor: Unit, plan: DashPlan, via: string | null): boolean {
  for (let i = 1; i < plan.path.length; i++) {
    if (!actor.alive) return false;
    const from = actor.pos;
    const to = plan.path[i]!;
    actor.pos = to;
    emit(ctx, 'UNIT_MOVED', { unitId: actor.id, from, to, cost: plan.stepCosts[i - 1] ?? 1, mpAfter: actor.mp, dash: true, via });
    exposeUnitToSurface(ctx, actor, 'enter');
  }
  return actor.alive;
}
