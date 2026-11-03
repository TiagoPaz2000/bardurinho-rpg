/**
 * Reações ambientais (seções 5.3 e 8.3). Magias apenas emitem estímulos
 * (calor, frio, água); este módulo decide o que acontece com cada célula e objeto.
 */
import { coordKey, orthogonalNeighbors, squareArea } from '../core/coords.js';
import type { Coord } from '../core/types.js';
import { damageEntity } from '../combat/damage.js';
import { getCell } from '../map/grid.js';
import { hasLineOfSight } from '../map/lineOfSight.js';
import type { Stimulus } from '../rules/definitions.js';
import { emit, withCause, type ResolutionContext } from '../state/context.js';
import { activeObjects, entitiesAt, objectsAt, unitAt } from '../state/queries.js';
import type { MapObject } from '../state/types.js';
import { removeStatus } from './statuses.js';
import { createSurface, removeSurface, type SurfaceSource } from './surfaces.js';

/** Durações iniciais (hipóteses de balanceamento da seção 5.3). */
export const REACTION_TUNING = {
  oilFireRounds: 3,
  thornsFireRounds: 2,
  burningStatusId: 'burning',
} as const;

export function emitStimulus(ctx: ResolutionContext, c: Coord, stimulus: Stimulus, source: SurfaceSource): void {
  if (!getCell(ctx.state.map, c)) return;
  emit(ctx, 'STIMULUS_EMITTED', { cell: c, stimulus });
  switch (stimulus) {
    case 'heat':
      return applyHeat(ctx, c, source);
    case 'cold':
      return applyCold(ctx, c, 'cold_effect');
    case 'water':
      return applyCold(ctx, c, 'water');
  }
}

function applyHeat(ctx: ResolutionContext, c: Coord, source: SurfaceSource): void {
  const surface = getCell(ctx.state.map, c)?.surface?.kind;
  if (surface === 'oil' || surface === 'thorns') igniteCell(ctx, c, source);
  heatObjectsAt(ctx, c);
}

/** Frio e água apagam fogo na célula, removem Queimando e combustão de objetos. */
function applyCold(ctx: ResolutionContext, c: Coord, reason: string): void {
  if (removeSurface(ctx, c, reason, 'fire')) {
    emit(ctx, 'REACTION_TRIGGERED', { reaction: `${reason}_extinguish_fire`, cell: c });
  }
  const unit = unitAt(ctx.state, c);
  if (unit && removeStatus(ctx, unit, REACTION_TUNING.burningStatusId, reason)) {
    emit(ctx, 'REACTION_TRIGGERED', { reaction: `${reason}_remove_burning`, cell: c, unitId: unit.id });
  }
  for (const obj of objectsAt(ctx.state, c)) {
    if (obj.burning) {
      obj.burning = false;
      emit(ctx, 'OBJECT_EXTINGUISHED', { objectId: obj.id, reason });
    }
  }
}

/**
 * Calor sobre óleo: consome a mancha conectada (mesmo andar) e cria fogo por 3 rodadas.
 * Calor sobre espinhos: destrói os espinhos e cria fogo por 2 rodadas.
 */
export function igniteCell(ctx: ResolutionContext, c: Coord, source: SurfaceSource): void {
  const cell = getCell(ctx.state.map, c);
  const kind = cell?.surface?.kind;
  if (kind === 'oil' || kind === 'fire') {
    const patch = kind === 'oil' ? connectedOil(ctx, c) : [c];
    emit(ctx, 'REACTION_TRIGGERED', { reaction: 'heat_oil', origin: c, cells: patch });
    for (const p of patch) {
      // Converte primeiro, depois expõe; evita reentrar na mesma mancha.
      removeSurface(ctx, p, 'ignited', 'oil');
      createSurface(ctx, p, 'fire', REACTION_TUNING.oilFireRounds, source);
    }
    return;
  }
  if (kind === 'thorns') {
    emit(ctx, 'REACTION_TRIGGERED', { reaction: 'heat_thorns', origin: c });
    removeSurface(ctx, c, 'burned', 'thorns');
    createSurface(ctx, c, 'fire', REACTION_TUNING.thornsFireRounds, source);
    // O fogo criado alcança óleo vizinho.
    for (const n of orthogonalNeighbors(c)) {
      if (getCell(ctx.state.map, n)?.surface?.kind === 'oil') igniteCell(ctx, n, source);
    }
  }
}

function connectedOil(ctx: ResolutionContext, start: Coord): Coord[] {
  const seen = new Set<string>([coordKey(start)]);
  const queue = [start];
  const out: Coord[] = [];
  while (queue.length) {
    const c = queue.shift()!;
    out.push(c);
    for (const n of orthogonalNeighbors(c)) {
      const k = coordKey(n);
      if (seen.has(k)) continue;
      if (getCell(ctx.state.map, n)?.surface?.kind === 'oil') {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return out;
}

/** Calor sobre objetos: explosivos detonam; inflamáveis entram em combustão. */
export function heatObjectsAt(ctx: ResolutionContext, c: Coord): void {
  for (const obj of objectsAt(ctx.state, c)) {
    const def = ctx.catalog.objects[obj.defId];
    if (!def) continue;
    if (def.explosion) {
      emit(ctx, 'REACTION_TRIGGERED', { reaction: 'heat_explosive', objectId: obj.id });
      destroyObject(ctx, obj, 'HEAT');
    } else if (def.flammable && !obj.burning) {
      obj.burning = true;
      emit(ctx, 'OBJECT_IGNITED', { objectId: obj.id });
    }
  }
}

export function destroyObject(ctx: ResolutionContext, obj: MapObject, reason: string): void {
  if (obj.state === 'destroyed') return;
  obj.state = 'destroyed';
  obj.burning = false;
  if (obj.hp !== null) obj.hp = 0;
  emit(ctx, 'OBJECT_DESTROYED', { objectId: obj.id, defId: obj.defId, reason, pos: obj.pos });
  const def = ctx.catalog.objects[obj.defId];
  if (def?.explosion) explode(ctx, obj);
}

/**
 * Explosão: dano em raio lógico limitado pelo andar e por paredes, seguida de calor
 * em cada célula atingida (pode gerar reações em cadeia).
 */
function explode(ctx: ResolutionContext, obj: MapObject): void {
  const def = ctx.catalog.objects[obj.defId]!;
  const blast = def.explosion!;
  const cells = squareArea(obj.pos, blast.radius).filter((c) => {
    const cell = getCell(ctx.state.map, c);
    return !!cell && cell.terrain !== 'wall' && hasLineOfSight(ctx.state, ctx.catalog, obj.pos, c);
  });
  withCause(ctx, { sourceId: obj.id, definitionId: def.id }, () => {
    emit(ctx, 'EXPLOSION', { objectId: obj.id, center: obj.pos, cells, damage: blast.damage });
    for (const c of cells) {
      for (const entity of entitiesAt(ctx.state, c)) {
        damageEntity(ctx, entity, blast.damage, blast.damageType, { via: def.id });
      }
    }
    for (const c of cells) emitStimulus(ctx, c, 'heat', { sourceId: obj.id, definitionId: def.id });
  });
}

/** Início de rodada: objetos em combustão recebem dano de fogo. */
export function tickObjectCombustion(ctx: ResolutionContext): void {
  for (const obj of activeObjects(ctx.state)) {
    if (!obj.burning) continue;
    const amount = ctx.catalog.objects[obj.defId]?.combustionDamage ?? 0;
    if (amount > 0) damageEntity(ctx, obj, amount, 'fire', { via: 'reaction.combustion' });
  }
}
