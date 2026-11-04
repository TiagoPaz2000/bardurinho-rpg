/**
 * Formato de cenário de teste (initial.json / commands.json / expected.json).
 * Usado pelos testes automatizados, pelo Debug Lab (exportar/importar) e por replays.
 */
import type { Coord, EntityId, Resistances } from '../core/types.js';
import { allCoords, createMapFromAscii, getCell, mapToAscii, type FloorConnection, type SurfaceKind } from '../map/grid.js';
import type { Catalog } from '../rules/definitions.js';
import { applyCommand, applyCommands } from '../commands/engine.js';
import type { Command, CommandError, ExecutionOptions } from '../commands/types.js';
import { createDummy, createGameState, createObject, createUnitFromClass } from '../state/factory.js';
import type { GameEvent } from '../state/events.js';
import type { GameState, MapObject, Unit } from '../state/types.js';

export interface ScenarioPos {
  x: number;
  y: number;
  floor?: number;
}

export type ScenarioUnit =
  | {
      id: EntityId;
      classId: string;
      team: string;
      pos: ScenarioPos;
      /** Nome de exibição (Fase 5: nome do personagem do jogador). */
      name?: string;
      accessoryId?: string | null;
      consumables?: string[];
      hp?: number;
      focus?: number;
    }
  | {
      id: EntityId;
      type: 'debug.test-dummy';
      preset?: string;
      pos: ScenarioPos;
      team?: string;
      hp?: number;
      maxHp?: number;
      armor?: number;
      defense?: number;
      resistances?: Resistances;
      immortal?: boolean;
    };

export interface ScenarioInitial {
  name?: string;
  description?: string;
  map: { floors: string[][]; connections?: Array<{ a: ScenarioPos; b: ScenarioPos; cost?: number }> };
  units?: ScenarioUnit[];
  objects?: Array<{ id: EntityId; defId: string; pos: ScenarioPos; state?: MapObject['state']; linkedId?: EntityId }>;
  surfaces?: Array<{ cells: ScenarioPos[]; surface: SurfaceKind; durationRounds?: number | null }>;
  order?: EntityId[];
  maxRounds?: number;
  /** Dados: `average` (padrão em cenários de teste: cada dado vale a média arredondada para cima) ou `random`. */
  dice?: 'random' | 'average';
  seed?: number;
  /** Iniciativa: `fixed` (padrão em cenários: usa `order`) ou `roll` (d20). */
  initiative?: 'roll' | 'fixed';
  /** Inicia a partida automaticamente (padrão: true). */
  autoStart?: boolean;
}

export interface ScenarioExpected {
  errors?: number;
  status?: GameState['status'];
  result?: GameState['result'];
  round?: number;
  activeUnitId?: EntityId | null;
  units?: Record<EntityId, Partial<{ hp: number; alive: boolean; focus: number; ap: number; mp: number; shield: number; pos: ScenarioPos; statuses: string[] }>>;
  objects?: Record<EntityId, Partial<{ hp: number; state: MapObject['state']; burning: boolean }>>;
  cells?: Array<ScenarioPos & { surface: SurfaceKind | null; expiresAtRound?: number | null }>;
  /** Tipos de evento esperados, como subsequência ordenada dos eventos obtidos. */
  events?: string[];
  /** Tipos de evento que não podem ocorrer. */
  forbiddenEvents?: string[];
  damage?: Array<Partial<{ targetId: string; raw: number; damageType: string; mitigation: number; shieldAbsorbed: number; hpDamage: number; hpAfter: number }>>;
}

const toCoord = (p: ScenarioPos): Coord => ({ x: p.x, y: p.y, floor: p.floor ?? 0 });

export function buildScenario(catalog: Catalog, initial: ScenarioInitial): GameState {
  const connections: FloorConnection[] = (initial.map.connections ?? []).map((c) => ({
    a: toCoord(c.a),
    b: toCoord(c.b),
    cost: c.cost ?? 2,
  }));
  const map = createMapFromAscii(initial.map.floors, connections);
  const units: Unit[] = (initial.units ?? []).map((spec) => {
    if ('type' in spec) {
      return createDummy(catalog, {
        id: spec.id,
        presetId: spec.preset ?? 'dummy.default',
        pos: toCoord(spec.pos),
        ...(spec.team ? { team: spec.team } : {}),
        overrides: {
          ...(spec.hp !== undefined ? { hp: spec.hp } : {}),
          ...(spec.maxHp !== undefined ? { maxHp: spec.maxHp } : {}),
          ...(spec.armor !== undefined ? { armor: spec.armor } : {}),
          ...(spec.defense !== undefined ? { defense: spec.defense } : {}),
          ...(spec.resistances ? { resistances: spec.resistances } : {}),
          ...(spec.immortal !== undefined ? { immortal: spec.immortal } : {}),
        },
      });
    }
    const unit = createUnitFromClass(catalog, {
      id: spec.id,
      classId: spec.classId,
      team: spec.team,
      pos: toCoord(spec.pos),
      ...(spec.name ? { name: spec.name } : {}),
      accessoryId: spec.accessoryId ?? null,
      consumables: spec.consumables ?? [],
    });
    if (spec.hp !== undefined) unit.hp = spec.hp;
    if (spec.focus !== undefined) unit.focus = spec.focus;
    return unit;
  });
  const objects = (initial.objects ?? []).map((o) =>
    createObject(catalog, { id: o.id, defId: o.defId, pos: toCoord(o.pos), ...(o.state ? { state: o.state } : {}), linkedId: o.linkedId ?? null }),
  );
  let state = createGameState(catalog, map, {
    units,
    objects,
    ...(initial.order ? { order: initial.order } : {}),
    ...(initial.maxRounds ? { maxRounds: initial.maxRounds } : {}),
    dice: initial.dice ?? 'average',
    seed: initial.seed ?? 1,
    initiative: initial.initiative ?? 'fixed',
  });
  for (const s of initial.surfaces ?? []) {
    for (const p of s.cells) {
      const cell = getCell(state.map, toCoord(p));
      if (cell && cell.terrain === 'ground') {
        cell.surface = {
          kind: s.surface,
          createdRound: 0,
          expiresAtRound: s.durationRounds ?? null,
          sourceId: null,
          sourceDefinitionId: 'scenario',
        };
      }
    }
  }
  if (initial.autoStart ?? true) {
    const r = applyCommand(state, catalog, { type: 'START_MATCH' });
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
  }
  return state;
}

export interface ScenarioRun {
  initialState: GameState;
  state: GameState;
  events: GameEvent[];
  errors: Array<{ index: number; error: CommandError }>;
}

export function runScenario(
  catalog: Catalog,
  initial: ScenarioInitial,
  commands: Command[],
  options: ExecutionOptions = {},
): ScenarioRun {
  const initialState = buildScenario(catalog, initial);
  const r = applyCommands(initialState, catalog, commands, options);
  return { initialState, ...r };
}

/** Compara o resultado com `expected.json`. Retorna a lista de divergências (vazia = ok). */
export function checkExpectations(run: ScenarioRun, expected: ScenarioExpected): string[] {
  const failures: string[] = [];
  const eq = (label: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      failures.push(`${label}: esperado ${JSON.stringify(wanted)}, obtido ${JSON.stringify(actual)}`);
    }
  };
  const { state, events } = run;
  if (expected.errors !== undefined) {
    eq('errors', run.errors.length, expected.errors);
    if (run.errors.length !== expected.errors) {
      failures.push(...run.errors.map((e) => `  comando #${e.index}: ${e.error.code} — ${e.error.message}`));
    }
  }
  if (expected.status !== undefined) eq('status', state.status, expected.status);
  if (expected.result !== undefined) eq('result', state.result, expected.result);
  if (expected.round !== undefined) eq('round', state.turn.round, expected.round);
  if (expected.activeUnitId !== undefined) eq('activeUnitId', state.turn.activeUnitId, expected.activeUnitId);

  for (const [id, want] of Object.entries(expected.units ?? {})) {
    const unit = state.units[id];
    if (!unit) {
      failures.push(`unidade ${id} não existe`);
      continue;
    }
    if (want.hp !== undefined) eq(`${id}.hp`, unit.hp, want.hp);
    if (want.alive !== undefined) eq(`${id}.alive`, unit.alive, want.alive);
    if (want.focus !== undefined) eq(`${id}.focus`, unit.focus, want.focus);
    if (want.ap !== undefined) eq(`${id}.ap`, unit.ap, want.ap);
    if (want.mp !== undefined) eq(`${id}.mp`, unit.mp, want.mp);
    if (want.shield !== undefined) eq(`${id}.shield`, unit.shield?.amount ?? 0, want.shield);
    if (want.pos !== undefined) eq(`${id}.pos`, unit.pos, toCoord(want.pos));
    if (want.statuses !== undefined) eq(`${id}.statuses`, unit.statuses.map((s) => s.statusId).sort(), [...want.statuses].sort());
  }
  for (const [id, want] of Object.entries(expected.objects ?? {})) {
    const obj = state.objects[id];
    if (!obj) {
      failures.push(`objeto ${id} não existe`);
      continue;
    }
    if (want.hp !== undefined) eq(`${id}.hp`, obj.hp, want.hp);
    if (want.state !== undefined) eq(`${id}.state`, obj.state, want.state);
    if (want.burning !== undefined) eq(`${id}.burning`, obj.burning, want.burning);
  }
  for (const want of expected.cells ?? []) {
    const c = toCoord(want);
    const cell = getCell(state.map, c);
    const label = `célula (${c.x},${c.y},${c.floor})`;
    eq(`${label}.surface`, cell?.surface?.kind ?? null, want.surface);
    if (want.expiresAtRound !== undefined) eq(`${label}.expiresAtRound`, cell?.surface?.expiresAtRound ?? null, want.expiresAtRound);
  }
  if (expected.events) {
    let i = 0;
    for (const e of events) if (e.type === expected.events[i]) i++;
    if (i < expected.events.length) {
      failures.push(
        `eventos: subsequência não encontrada a partir de ${expected.events[i]} (#${i}). Obtidos: ${events.map((e) => e.type).join(', ')}`,
      );
    }
  }
  for (const type of expected.forbiddenEvents ?? []) {
    if (events.some((e) => e.type === type)) failures.push(`evento proibido ocorreu: ${type}`);
  }
  if (expected.damage) {
    const damageEvents = events.filter((e) => e.type === 'DAMAGE_APPLIED').map((e) => e.payload);
    expected.damage.forEach((want, i) => {
      const got = damageEvents[i];
      if (!got) {
        failures.push(`dano #${i}: não ocorreu`);
        return;
      }
      for (const [k, v] of Object.entries(want)) eq(`dano #${i}.${k}`, got[k], v);
    });
  }
  return failures;
}

/** Exporta o estado atual como `initial.json` (Debug Lab → teste automatizado). */
export function exportScenario(state: GameState, name?: string): ScenarioInitial {
  const units: ScenarioUnit[] = Object.values(state.units).map((u) =>
    u.flags.isDummy
      ? {
          id: u.id,
          type: 'debug.test-dummy' as const,
          preset: u.dummyPresetId ?? 'dummy.default',
          team: u.team,
          pos: u.pos,
          hp: u.hp,
          maxHp: u.maxHp,
          armor: u.armor,
          defense: u.defense,
          resistances: u.resistances,
          immortal: !!u.flags.immortal,
        }
      : {
          id: u.id,
          classId: u.classId!,
          team: u.team,
          pos: u.pos,
          accessoryId: u.accessoryId,
          consumables: u.consumables,
          hp: u.hp,
          focus: u.focus,
        },
  );
  const surfaces: NonNullable<ScenarioInitial['surfaces']> = [];
  for (const c of allCoords(state.map)) {
    const s = getCell(state.map, c)?.surface;
    if (s) surfaces.push({ cells: [c], surface: s.kind, durationRounds: s.expiresAtRound === null ? null : Math.max(1, s.expiresAtRound - state.turn.round) });
  }
  return {
    ...(name ? { name } : {}),
    map: { floors: mapToAscii(state.map), connections: state.map.connections.map((c) => ({ a: c.a, b: c.b, cost: c.cost })) },
    units,
    objects: Object.values(state.objects).map((o) => ({
      id: o.id,
      defId: o.defId,
      pos: o.pos,
      state: o.state,
      ...(o.linkedId ? { linkedId: o.linkedId } : {}),
    })),
    surfaces,
    order: state.turn.order,
    maxRounds: state.maxRounds,
    dice: state.rng.mode,
    seed: state.rng.seed,
    initiative: state.initiative,
  };
}

/** Gera `expected.json` a partir do estado atual ("salvar estado atual como resultado esperado"). */
export function snapshotExpected(state: GameState, events: GameEvent[]): ScenarioExpected {
  const cells: NonNullable<ScenarioExpected['cells']> = [];
  for (const c of allCoords(state.map)) {
    const s = getCell(state.map, c)?.surface;
    if (s) cells.push({ ...c, surface: s.kind, expiresAtRound: s.expiresAtRound });
  }
  return {
    errors: 0,
    status: state.status,
    round: state.turn.round,
    units: Object.fromEntries(
      Object.values(state.units).map((u) => [
        u.id,
        { hp: u.hp, alive: u.alive, focus: u.focus, shield: u.shield?.amount ?? 0, pos: u.pos, statuses: u.statuses.map((s) => s.statusId) },
      ]),
    ),
    objects: Object.fromEntries(Object.values(state.objects).map((o) => [o.id, { hp: o.hp ?? undefined, state: o.state, burning: o.burning }])) as ScenarioExpected['objects'],
    cells,
    events: events.map((e) => e.type),
  };
}
