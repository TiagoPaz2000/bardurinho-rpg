/**
 * Visão individual para a rede (seções 11.4 e 17.10): o que o servidor pode enviar a uma
 * equipe. Puro e determinístico (sem Colyseus/PostgreSQL): usado pelo servidor, pelos
 * testes e pelo Combat Debug Lab (modo NETWORK).
 *
 * Estado (`projectStateForClient`):
 * - unidades inimigas não detectadas pela equipe são removidas (`projectStateForTeam`);
 * - unidades derrotadas continuam, com a posição (a derrota é pública; decisão da Fase 3);
 * - com a partida encerrada (`finished`) todas as unidades são enviadas (nada mais a esconder);
 * - a semente do gerador de dados é zerada (com ela o cliente poderia prever as rolagens);
 * - `surfaceHitsThisTurn` só mantém as unidades enviadas; `nextEventSeq` é zerado (Fase 6).
 * Terreno, objetos e superfícies continuam públicos (MVP, seção 6.2), assim como a ordem de
 * iniciativa e de quem é a vez (`turn.order` / `turn.activeUnitId`, só identificadores).
 *
 * Eventos (`projectEventsForTeam`), para um comando que levou `before` → `after`:
 * - "conhecidas" = unidades da equipe + unidades detectadas antes OU depois do comando;
 * - evento que cita só unidades desconhecidas (ex.: `UNIT_MOVED` de um inimigo oculto,
 *   `ABILITY_USED` dele, `RESOURCE_SPENT`) é descartado;
 * - evento que cita uma conhecida e uma desconhecida (ex.: dano num aliado vindo de um
 *   atacante oculto) é mantido com o identificador desconhecido trocado por `null`;
 * - passos (`UNIT_MOVED` / `FORCED_MOVE` / `MOVE_BLOCKED`) de inimigos só ficam se a célula de
 *   destino é visível para a equipe (antes ou depois do comando): ninguém vê o caminho por
 *   trás do muro;
 * - `COMMAND_ACCEPTED` de um comando adversário só leva `{ type, actorId }`;
 * - `cause.sourceId` desconhecido vira `null`;
 * - estrutura do turno (`TURN_STARTED`, `TURN_ENDED`, `ROUND_STARTED`, `MATCH_*`,
 *   `INITIATIVE_ROLLED`) é pública.
 */
import { coordKey } from '../core/coords.js';
import type { Coord, EntityId } from '../core/types.js';
import type { Catalog } from '../rules/definitions.js';
import type { GameEvent } from '../state/events.js';
import type { GameState } from '../state/types.js';
import { computeTeamVision, type TeamVision } from './visibility.js';

/** Campos de payload que citam uma entidade. */
const REF_KEYS = ['unitId', 'actorId', 'attackerId', 'targetId', 'entityId'] as const;
/** Eventos públicos: estrutura do turno e da partida. */
const PUBLIC_EVENTS = new Set(['TURN_STARTED', 'TURN_ENDED', 'ROUND_STARTED', 'MATCH_STARTED', 'MATCH_ENDED', 'INITIATIVE_ROLLED']);
const STEP_EVENTS = new Set(['UNIT_MOVED', 'FORCED_MOVE', 'MOVE_BLOCKED']);

export interface ClientProjection {
  state: GameState;
  vision: TeamVision;
}

/** Estado que pode ser enviado à equipe (ver o cabeçalho). */
export function projectStateForClient(state: GameState, catalog: Catalog, team: string, precomputed?: TeamVision): ClientProjection {
  // Fase 6: o servidor pode passar a visão já calculada (a mesma do estado) para não refazê-la.
  const vision = precomputed ?? computeTeamVision(state, catalog, team);
  const projected = structuredClone(state);
  // Partida encerrada: não há mais o que esconder (tela de resultado com todos os personagens).
  if (state.status !== 'finished') {
    for (const [id, u] of Object.entries(projected.units)) {
      if (!vision.visibleUnits.has(id) && u.alive) delete projected.units[id];
    }
  }
  projected.rng = { mode: projected.rng.mode, seed: 0, draws: 0, forced: [] };
  // Fase 6: o contador de eventos oficial revelaria quantos eventos ocultos aconteceram.
  projected.nextEventSeq = 0;
  for (const id of Object.keys(projected.surfaceHitsThisTurn)) if (!projected.units[id]) delete projected.surfaceHitsThisTurn[id];
  return { state: projected, vision };
}

/** Unidades que a equipe conhece no comando `before` → `after` (ver o cabeçalho). */
function knownUnits(before: GameState, after: GameState, vb: TeamVision, va: TeamVision, team: string): Set<EntityId> {
  const known = new Set<EntityId>([...vb.visibleUnits, ...va.visibleUnits]);
  for (const s of [before, after]) for (const u of Object.values(s.units)) if (u.team === team || !u.alive) known.add(u.id); // derrota é pública
  return known;
}

/** Eventos de um comando que podem ser enviados à equipe (ver o cabeçalho). */
export function projectEventsForTeam(
  events: readonly GameEvent[],
  before: GameState,
  after: GameState,
  catalog: Catalog,
  team: string,
  visions: { before?: TeamVision; after?: TeamVision } = {},
): GameEvent[] {
  const vb = visions.before ?? computeTeamVision(before, catalog, team);
  const va = visions.after ?? computeTeamVision(after, catalog, team);
  const known = knownUnits(before, after, vb, va, team);
  const isUnit = (id: unknown): id is string => typeof id === 'string' && (id in after.units || id in before.units);
  const unknownUnit = (id: unknown) => isUnit(id) && !known.has(id);
  const cellVisible = (c: Coord | undefined) => !!c && (vb.visibleCells.has(coordKey(c)) || va.visibleCells.has(coordKey(c)));
  const teamOf = (id: string) => (after.units[id] ?? before.units[id])?.team;

  const out: GameEvent[] = [];
  for (const ev of events) {
    const e: GameEvent = structuredClone(ev);
    if (unknownUnit(e.cause.sourceId)) e.cause = { ...e.cause, sourceId: null };
    if (PUBLIC_EVENTS.has(e.type)) {
      out.push(e);
      continue;
    }
    if (e.type === 'COMMAND_ACCEPTED') {
      const cmd = e.payload.command as { type: string; actorId?: string };
      const actorId = cmd.actorId;
      if (actorId && teamOf(actorId) === team) out.push(e);
      else if (actorId && known.has(actorId)) out.push({ ...e, payload: { command: { type: cmd.type, actorId } } });
      continue;
    }
    const refs = REF_KEYS.filter((k) => isUnit(e.payload[k]));
    const unknownRefs = refs.filter((k) => unknownUnit(e.payload[k]));
    if (refs.length > 0 && unknownRefs.length === refs.length) continue;
    for (const k of unknownRefs) e.payload[k] = null;
    if (STEP_EVENTS.has(e.type)) {
      const unitId = e.payload.unitId as string;
      const at = (e.payload.to ?? e.payload.at) as Coord | undefined;
      if (teamOf(unitId) !== team && !cellVisible(at)) continue;
    }
    out.push(e);
  }
  return out;
}
