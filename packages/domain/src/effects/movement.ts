import type { Coord } from '../core/types.js';
import { emit, type ResolutionContext } from '../state/context.js';
import { isCellFree } from '../state/queries.js';
import type { Unit } from '../state/types.js';
import { exposeUnitToSurface } from './surfaces.js';

/**
 * Percorre um caminho já validado, passo a passo. Cada célula de entrada aplica
 * as superfícies (fogo, espinhos). Se a unidade morrer, o deslocamento para.
 */
export function walkPath(ctx: ResolutionContext, unit: Unit, path: Coord[], stepCosts: number[]): { stoppedAt: Coord; spent: number } {
  let spent = 0;
  for (let i = 1; i < path.length; i++) {
    if (!unit.alive) break;
    const from = unit.pos;
    const to = path[i]!;
    const cost = stepCosts[i - 1] ?? 1;
    unit.pos = to;
    unit.mp -= cost;
    spent += cost;
    emit(ctx, 'UNIT_MOVED', { unitId: unit.id, from, to, cost, mpAfter: unit.mp });
    exposeUnitToSurface(ctx, unit, 'enter');
  }
  return { stoppedAt: unit.pos, spent };
}

/**
 * Deslocamento forçado em linha reta, afastando-se da origem. Não atravessa paredes,
 * personagens ou objetos bloqueantes e não derruba de plataformas (seção 4).
 * Enraizamento não impede deslocamento forçado.
 */
export function forceMove(ctx: ResolutionContext, unit: Unit, origin: Coord, cells: number, via: string | null): number {
  if (!unit.alive) return 0;
  const dx = Math.sign(unit.pos.x - origin.x);
  const dy = Math.sign(unit.pos.y - origin.y);
  // Somente linhas retas ortogonais.
  const dir = Math.abs(unit.pos.x - origin.x) >= Math.abs(unit.pos.y - origin.y) ? { x: dx, y: 0 } : { x: 0, y: dy };
  if (dir.x === 0 && dir.y === 0) return 0;
  let moved = 0;
  for (let i = 0; i < cells; i++) {
    if (!unit.alive) break;
    const next = { x: unit.pos.x + dir.x, y: unit.pos.y + dir.y, floor: unit.pos.floor };
    if (!isCellFree(ctx.state, ctx.catalog, next)) {
      emit(ctx, 'MOVE_BLOCKED', { unitId: unit.id, at: next, reason: 'OBSTACLE', forced: true });
      break;
    }
    const from = unit.pos;
    unit.pos = next;
    moved++;
    emit(ctx, 'FORCED_MOVE', { unitId: unit.id, from, to: next, via });
    exposeUnitToSurface(ctx, unit, 'enter');
  }
  return moved;
}
