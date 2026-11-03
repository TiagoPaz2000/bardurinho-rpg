import { coordKey, orthogonalNeighbors, sameCoord } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import type { Catalog } from '../rules/definitions.js';
import { isCellFree, isCellWalkable } from '../state/queries.js';
import type { GameState } from '../state/types.js';
import { getCell } from './grid.js';

export interface PathResult {
  /** Inclui a origem e o destino. */
  path: Coord[];
  /** Custo de cada passo (path.length - 1 entradas). */
  stepCosts: number[];
  cost: number;
}

export interface PathOptions {
  maxCost?: number;
  /** Permite atravessar ligações entre andares (escadas). Padrão: true. */
  allowConnections?: boolean;
}

/** Custo para entrar em uma célula, segundo a superfície (seção 5.2). */
export function enterCost(state: GameState, catalog: Catalog, c: Coord): number {
  const surface = getCell(state.map, c)?.surface;
  return surface ? (catalog.surfaces[surface.kind]?.enterCost ?? 1) : 1;
}

/** Vizinhos alcançáveis em um passo, com custo. Ordem determinística. */
export function stepsFrom(
  state: GameState,
  catalog: Catalog,
  from: Coord,
  allowConnections = true,
): Array<{ to: Coord; cost: number }> {
  const out: Array<{ to: Coord; cost: number }> = [];
  for (const n of orthogonalNeighbors(from)) {
    if (isCellFree(state, catalog, n)) out.push({ to: n, cost: enterCost(state, catalog, n) });
  }
  if (allowConnections) {
    for (const conn of state.map.connections) {
      const other = sameCoord(conn.a, from) ? conn.b : sameCoord(conn.b, from) ? conn.a : null;
      if (other && isCellFree(state, catalog, other)) out.push({ to: other, cost: conn.cost });
    }
  }
  return out;
}

/**
 * Menor caminho (Dijkstra) em quatro direções, sem diagonais. Unidades e objetos
 * bloqueantes impedem a passagem. Retorna `null` se não houver caminho.
 */
export function findPath(
  state: GameState,
  catalog: Catalog,
  from: Coord,
  to: Coord,
  options: PathOptions = {},
): PathResult | null {
  if (sameCoord(from, to)) return { path: [from], stepCosts: [], cost: 0 };
  if (!isCellWalkable(state, catalog, to)) return null;
  const maxCost = options.maxCost ?? Infinity;
  const dist = new Map<string, number>([[coordKey(from), 0]]);
  const prev = new Map<string, { from: Coord; cost: number }>();
  // Fila simples ordenada; mapas do MVP são pequenos (16×16×2).
  const open: Array<{ c: Coord; d: number; order: number }> = [{ c: from, d: 0, order: 0 }];
  let counter = 1;
  const goalKey = coordKey(to);
  while (open.length) {
    open.sort((a, b) => a.d - b.d || a.order - b.order);
    const current = open.shift()!;
    const key = coordKey(current.c);
    if (current.d > (dist.get(key) ?? Infinity)) continue;
    if (key === goalKey) break;
    for (const step of stepsFrom(state, catalog, current.c, options.allowConnections ?? true)) {
      const nd = current.d + step.cost;
      if (nd > maxCost) continue;
      const nk = coordKey(step.to);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, { from: current.c, cost: step.cost });
        open.push({ c: step.to, d: nd, order: counter++ });
      }
    }
  }
  if (!dist.has(goalKey)) return null;
  const path: Coord[] = [to];
  const stepCosts: number[] = [];
  let k = goalKey;
  while (k !== coordKey(from)) {
    const p = prev.get(k)!;
    stepCosts.unshift(p.cost);
    path.unshift(p.from);
    k = coordKey(p.from);
  }
  return { path, stepCosts, cost: dist.get(goalKey)! };
}

/** Todas as células alcançáveis com até `budget` PM (para destaque de movimento). */
export function reachableCells(
  state: GameState,
  catalog: Catalog,
  from: Coord,
  budget: number,
): Map<string, { coord: Coord; cost: number }> {
  const result = new Map<string, { coord: Coord; cost: number }>([[coordKey(from), { coord: from, cost: 0 }]]);
  const open: Array<{ c: Coord; d: number }> = [{ c: from, d: 0 }];
  while (open.length) {
    open.sort((a, b) => a.d - b.d);
    const current = open.shift()!;
    for (const step of stepsFrom(state, catalog, current.c)) {
      const nd = current.d + step.cost;
      if (nd > budget) continue;
      const nk = coordKey(step.to);
      if (nd < (result.get(nk)?.cost ?? Infinity)) {
        result.set(nk, { coord: step.to, cost: nd });
        open.push({ c: step.to, d: nd });
      }
    }
  }
  return result;
}
