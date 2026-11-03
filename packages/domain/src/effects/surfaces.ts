import { formatCoord } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import { damageUnit } from '../combat/damage.js';
import { allCoords, getCell, type SurfaceKind } from '../map/grid.js';
import { emit, withCause, type ResolutionContext } from '../state/context.js';
import { unitAt } from '../state/queries.js';
import type { Unit } from '../state/types.js';
import { heatObjectsAt, igniteCell } from './reactions.js';

export interface SurfaceSource {
  sourceId: EntityId | null;
  definitionId: string | null;
}

export type SurfaceCreateOutcome = 'created' | 'refreshed' | 'reacted' | 'incompatible' | 'invalidCell';

/**
 * Cria uma superfície respeitando as regras de compatibilidade (seção 5.3):
 * - espinhos não substituem óleo nem fogo;
 * - óleo lançado sobre fogo incendeia imediatamente;
 * - fogo sobre óleo incendeia a mancha conectada.
 * Criar uma superfície sob um personagem conta como exposição inicial.
 */
export function createSurface(
  ctx: ResolutionContext,
  c: Coord,
  kind: SurfaceKind,
  durationRounds: number | null,
  source: SurfaceSource,
): SurfaceCreateOutcome {
  const cell = getCell(ctx.state.map, c);
  if (!cell || cell.terrain !== 'ground') return 'invalidCell';
  const existing = cell.surface?.kind ?? null;

  if (existing === 'fire' && kind === 'oil') {
    emit(ctx, 'REACTION_TRIGGERED', { reaction: 'oil_on_fire', cell: c });
    igniteCell(ctx, c, source);
    return 'reacted';
  }
  if (existing === 'oil' && kind === 'fire') {
    igniteCell(ctx, c, source);
    return 'reacted';
  }
  if (existing && existing !== kind && kind !== 'fire') return 'incompatible';

  const round = ctx.state.turn.round;
  const expiresAtRound = durationRounds === null ? null : round + durationRounds;
  if (existing === kind && cell.surface) {
    const current = cell.surface.expiresAtRound;
    cell.surface.expiresAtRound =
      current === null || expiresAtRound === null ? null : Math.max(current, expiresAtRound);
    emit(ctx, 'SURFACE_CREATED', { cell: c, surface: kind, expiresAtRound: cell.surface.expiresAtRound, refreshed: true });
    return 'refreshed';
  }

  if (existing) emit(ctx, 'SURFACE_REMOVED', { cell: c, surface: existing, reason: `replaced_by_${kind}` });
  cell.surface = {
    kind,
    createdRound: round,
    expiresAtRound,
    sourceId: source.sourceId,
    sourceDefinitionId: source.definitionId,
  };
  emit(ctx, 'SURFACE_CREATED', { cell: c, surface: kind, expiresAtRound, refreshed: false });

  if (kind === 'fire') heatObjectsAt(ctx, c);
  const occupant = unitAt(ctx.state, c);
  if (occupant) exposeUnitToSurface(ctx, occupant, 'created');
  return 'created';
}

export function removeSurface(ctx: ResolutionContext, c: Coord, reason: string, only?: SurfaceKind): boolean {
  const cell = getCell(ctx.state.map, c);
  if (!cell?.surface) return false;
  if (only && cell.surface.kind !== only) return false;
  const kind = cell.surface.kind;
  cell.surface = null;
  emit(ctx, 'SURFACE_REMOVED', { cell: c, surface: kind, reason });
  return true;
}

/** Pintura direta (preparação de cenário no Debug Lab): sem reações nem exposição. */
export function setSurfaceDirect(ctx: ResolutionContext, c: Coord, kind: SurfaceKind | null, durationRounds: number | null = null): void {
  const cell = getCell(ctx.state.map, c);
  if (!cell || cell.terrain !== 'ground') return;
  const round = ctx.state.turn.round;
  cell.surface = kind
    ? { kind, createdRound: round, expiresAtRound: durationRounds === null ? null : round + durationRounds, sourceId: null, sourceDefinitionId: 'debug.paint' }
    : null;
}

export type ExposureTrigger = 'enter' | 'turnStart' | 'created';

/**
 * Aplica o dano da superfície sob a unidade. O dano de uma mesma categoria ocorre no
 * máximo uma vez por personagem por turno global (seção 5.2).
 */
export function exposeUnitToSurface(ctx: ResolutionContext, unit: Unit, trigger: ExposureTrigger): void {
  if (!unit.alive || unit.flags.immuneSurfaces) return;
  const cell = getCell(ctx.state.map, unit.pos);
  const surface = cell?.surface;
  if (!surface) return;
  const def = ctx.catalog.surfaces[surface.kind];
  if (!def?.exposureDamage) return;
  const hits = (ctx.state.surfaceHitsThisTurn[unit.id] ??= []);
  if (hits.includes(surface.kind)) {
    emit(ctx, 'SURFACE_EXPOSURE', { unitId: unit.id, surface: surface.kind, cell: unit.pos, trigger, applied: false, reason: 'ALREADY_HIT_THIS_TURN' });
    return;
  }
  hits.push(surface.kind);
  withCause(ctx, { sourceId: surface.sourceId, definitionId: def.id }, () => {
    emit(ctx, 'SURFACE_EXPOSURE', { unitId: unit.id, surface: surface.kind, cell: unit.pos, trigger, applied: true });
    damageUnit(ctx, unit, def.exposureDamage!.amount, def.exposureDamage!.damageType, { via: def.id });
  });
}

/** Uma superfície criada na rodada R com duração 3 expira no início de R + 3 (seção 5.3). */
export function expireSurfaces(ctx: ResolutionContext): void {
  const round = ctx.state.turn.round;
  for (const c of allCoords(ctx.state.map)) {
    const cell = getCell(ctx.state.map, c)!;
    if (cell.surface && cell.surface.expiresAtRound !== null && cell.surface.expiresAtRound <= round) {
      const kind = cell.surface.kind;
      cell.surface = null;
      emit(ctx, 'SURFACE_EXPIRED', { cell: c, surface: kind, label: formatCoord(c) });
    }
  }
}
