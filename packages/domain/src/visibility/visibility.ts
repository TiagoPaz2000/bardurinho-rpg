/**
 * Visibilidade e detecção (seção 6.2) e projeção do estado por equipe (seção 11.4).
 *
 * - Visão de até 8 células (distância da seção 2.3), limitada por linha de visão.
 * - Em área escura não iluminada, personagens só são detectados a até 2 células.
 * - Fogo ilumina até 2 células.
 * - Oculto: só é detectado a até 1 célula ou quando iluminado (hipótese do MVP).
 */
import { coordKey, distance } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import { allCoords, getCell } from '../map/grid.js';
import { hasLineOfSight } from '../map/lineOfSight.js';
import type { Catalog } from '../rules/definitions.js';
import { activeObjects, livingUnits } from '../state/queries.js';
import type { GameState, Unit } from '../state/types.js';

export const VISIBILITY_TUNING = {
  visionRange: 8,
  darkDetectionRange: 2,
  fireLightRange: 2,
  hiddenDetectionRange: 1,
  hiddenAttackBonus: 4,
  hiddenStatusId: 'hidden',
  burningStatusId: 'burning',
} as const;

export const isHidden = (unit: Unit): boolean =>
  unit.statuses.some((s) => s.statusId === VISIBILITY_TUNING.hiddenStatusId);

/** Equipes inimigas observam; bonecos de teste não observam nem são observadores. */
export const isObserver = (u: Unit): boolean => u.alive && !u.flags.isDummy;
export const areEnemies = (a: Unit, b: Unit): boolean => a.team !== b.team && !a.flags.isDummy && !b.flags.isDummy;

/** Fontes de luz lógica: fogo no chão, objetos em combustão e personagens Queimando. */
export function lightSources(state: GameState): Coord[] {
  const out: Coord[] = [];
  for (const c of allCoords(state.map)) if (getCell(state.map, c)?.surface?.kind === 'fire') out.push(c);
  for (const o of activeObjects(state)) if (o.burning) out.push(o.pos);
  for (const u of livingUnits(state)) if (u.statuses.some((s) => s.statusId === VISIBILITY_TUNING.burningStatusId)) out.push(u.pos);
  return out;
}

export function isLit(state: GameState, c: Coord, sources = lightSources(state)): boolean {
  return sources.some((s) => s.floor === c.floor && distance(s, c) <= VISIBILITY_TUNING.fireLightRange);
}

/** O observador enxerga a célula (alcance de visão + linha de visão + regra de área escura). */
export function canSeeCell(state: GameState, catalog: Catalog, observer: Unit, c: Coord, sources = lightSources(state)): boolean {
  const d = distance(observer.pos, c);
  if (d > VISIBILITY_TUNING.visionRange) return false;
  if (!hasLineOfSight(state, catalog, observer.pos, c)) return false;
  const cell = getCell(state.map, c);
  if (cell?.dark && !isLit(state, c, sources)) return d <= VISIBILITY_TUNING.darkDetectionRange;
  return true;
}

/**
 * O observador detecta o alvo. `ignoreHidden` avalia como se o alvo não estivesse
 * Oculto (usado para saber se a Ocultação pode ser ativada).
 */
export function canDetectUnit(
  state: GameState,
  catalog: Catalog,
  observer: Unit,
  target: Unit,
  options: { ignoreHidden?: boolean; sources?: Coord[] } = {},
): boolean {
  if (!target.alive) return false;
  if (observer.id === target.id || observer.team === target.team) return true;
  const sources = options.sources ?? lightSources(state);
  if (!canSeeCell(state, catalog, observer, target.pos, sources)) return false;
  if (!options.ignoreHidden && isHidden(target)) {
    return distance(observer.pos, target.pos) <= VISIBILITY_TUNING.hiddenDetectionRange || isLit(state, target.pos, sources);
  }
  return true;
}

/** Alguma unidade da equipe detecta o alvo. */
export function teamDetects(state: GameState, catalog: Catalog, team: string, target: Unit, options: { ignoreHidden?: boolean } = {}): boolean {
  if (target.team === team) return true;
  const sources = lightSources(state);
  return livingUnits(state).some((o) => o.team === team && isObserver(o) && canDetectUnit(state, catalog, o, target, { ...options, sources }));
}

/** Ocultação: fora da visão inimiga ou dentro de uma área escura (seção 4). */
export function canHide(state: GameState, catalog: Catalog, unit: Unit): boolean {
  if (getCell(state.map, unit.pos)?.dark) return true;
  const sources = lightSources(state);
  return !livingUnits(state).some(
    (o) => isObserver(o) && areEnemies(o, unit) && canDetectUnit(state, catalog, o, unit, { ignoreHidden: true, sources }),
  );
}

export interface TeamVision {
  team: string;
  /** Chaves `x,y,floor` das células visíveis para a equipe. */
  visibleCells: Set<string>;
  /** Unidades detectadas pela equipe (inclui as próprias). */
  visibleUnits: Set<EntityId>;
}

export function computeTeamVision(state: GameState, catalog: Catalog, team: string): TeamVision {
  const sources = lightSources(state);
  const observers = livingUnits(state).filter((u) => u.team === team && isObserver(u));
  const visibleCells = new Set<string>();
  for (const c of allCoords(state.map)) {
    if (observers.some((o) => canSeeCell(state, catalog, o, c, sources))) visibleCells.add(coordKey(c));
  }
  for (const o of observers) visibleCells.add(coordKey(o.pos));
  const visibleUnits = new Set<EntityId>();
  for (const u of Object.values(state.units)) {
    if (u.team === team || observers.some((o) => canDetectUnit(state, catalog, o, u, { sources }))) visibleUnits.add(u.id);
  }
  return { team, visibleCells, visibleUnits };
}

/**
 * Visão individual (seção 11.4): cópia do estado sem as unidades que a equipe não detecta.
 * MVP: terreno, objetos e superfícies continuam conhecidos; a filtragem de eventos
 * por equipe entra com o servidor (Fase 3).
 */
export function projectStateForTeam(state: GameState, catalog: Catalog, team: string): { state: GameState; vision: TeamVision } {
  const vision = computeTeamVision(state, catalog, team);
  const projected = structuredClone(state);
  for (const id of Object.keys(projected.units)) {
    if (!vision.visibleUnits.has(id)) delete projected.units[id];
  }
  return { state: projected, vision };
}
