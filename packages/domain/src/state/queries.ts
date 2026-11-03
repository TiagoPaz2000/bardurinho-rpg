import { sameCoord } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import { getCell } from '../map/grid.js';
import type { Catalog } from '../rules/definitions.js';
import type { Entity, GameState, MapObject, Unit } from './types.js';

// Ordenação determinística: sempre iterar entidades por id.
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const livingUnits = (state: GameState): Unit[] =>
  Object.values(state.units).filter((u) => u.alive).sort(byId);

export const activeObjects = (state: GameState): MapObject[] =>
  Object.values(state.objects).filter((o) => o.state !== 'destroyed').sort(byId);

export const unitAt = (state: GameState, c: Coord): Unit | undefined =>
  livingUnits(state).find((u) => sameCoord(u.pos, c));

export const objectsAt = (state: GameState, c: Coord): MapObject[] =>
  activeObjects(state).filter((o) => sameCoord(o.pos, c));

export const entitiesAt = (state: GameState, c: Coord): Entity[] => {
  const unit = unitAt(state, c);
  return [...(unit ? [unit] : []), ...objectsAt(state, c)];
};

export const getEntity = (state: GameState, id: EntityId): Entity | undefined =>
  state.units[id] ?? state.objects[id];

export function objectBlocksMovement(catalog: Catalog, obj: MapObject): boolean {
  const def = catalog.objects[obj.defId];
  return !!def && def.blocksMovementIn.includes(obj.state);
}

export function objectBlocksVision(catalog: Catalog, obj: MapObject): boolean {
  const def = catalog.objects[obj.defId];
  return !!def && def.blocksVisionIn.includes(obj.state);
}

/** Uma célula pode ser ocupada por uma unidade (ignorando quem já está nela). */
export function isCellWalkable(state: GameState, catalog: Catalog, c: Coord): boolean {
  const cell = getCell(state.map, c);
  if (!cell || cell.terrain !== 'ground') return false;
  return !objectsAt(state, c).some((o) => objectBlocksMovement(catalog, o));
}

export function isCellFree(state: GameState, catalog: Catalog, c: Coord): boolean {
  return isCellWalkable(state, catalog, c) && !unitAt(state, c);
}

export function hasStatusFlag(state: GameState, catalog: Catalog, unit: Unit, flag: 'rooted' | 'hidden'): boolean {
  return unit.statuses.some((s) => !s.pendingStart && catalog.statuses[s.statusId]?.flags?.includes(flag));
}

export function hasStatus(unit: Unit, statusId: string): boolean {
  return unit.statuses.some((s) => s.statusId === statusId);
}

export const activeUnit = (state: GameState): Unit | undefined =>
  state.turn.activeUnitId ? state.units[state.turn.activeUnitId] : undefined;
