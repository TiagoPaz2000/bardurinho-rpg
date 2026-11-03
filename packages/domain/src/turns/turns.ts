/**
 * Turnos e rodadas (seção 2.2). Um turno é a vez de uma unidade; a rodada termina
 * depois que todas as unidades vivas da ordem agiram.
 */
import { emit, type ResolutionContext } from '../state/context.js';
import { onStatusesTurnEnd, onStatusesTurnStart, mpModifier } from '../effects/statuses.js';
import { exposeUnitToSurface, expireSurfaces } from '../effects/surfaces.js';
import { tickObjectCombustion } from '../effects/reactions.js';
import type { Unit } from '../state/types.js';
import { rollDie } from '../core/dice.js';

/** Foco recuperado no início de cada turno próprio (seção 2.1). */
export const FOCUS_REGEN_PER_TURN = 2;

export function startMatch(ctx: ResolutionContext): void {
  const { state } = ctx;
  if (state.status !== 'setup') return;
  state.status = 'active';
  state.turn.round = 1;
  state.turn.activeIndex = -1;
  if (state.initiative === 'roll') rollInitiative(ctx);
  emit(ctx, 'MATCH_STARTED', { order: state.turn.order, rulesVersion: state.rulesVersion, contentVersion: state.contentVersion });
  emit(ctx, 'ROUND_STARTED', { round: 1 });
  advanceToNextUnit(ctx);
}

/**
 * Iniciativa: cada personagem rola d20; a ordem é do maior para o menor. Empates mantêm a
 * ordem original (determinístico). Bonecos de teste não rolam e ficam no fim.
 */
function rollInitiative(ctx: ResolutionContext): void {
  const { state } = ctx;
  const ids = state.turn.order.filter((id) => state.units[id]);
  const rolls = ids
    .filter((id) => !state.units[id]!.flags.isDummy)
    .map((id, index) => ({ id, index, roll: rollDie(state.rng, 20) }));
  const sorted = [...rolls].sort((a, b) => b.roll - a.roll || a.index - b.index).map((r) => r.id);
  state.turn.order = [...sorted, ...ids.filter((id) => state.units[id]!.flags.isDummy)];
  emit(ctx, 'INITIATIVE_ROLLED', { rolls: rolls.map(({ id, roll }) => ({ unitId: id, roll })), order: state.turn.order });
}

/** Encerra o turno da unidade ativa e passa a vez. */
export function endTurn(ctx: ResolutionContext): void {
  const unit = currentUnit(ctx);
  if (unit) {
    onStatusesTurnEnd(ctx, unit);
    emit(ctx, 'TURN_ENDED', { unitId: unit.id });
  }
  if (ctx.state.status === 'active') advanceToNextUnit(ctx);
}

function currentUnit(ctx: ResolutionContext): Unit | undefined {
  const id = ctx.state.turn.activeUnitId;
  return id ? ctx.state.units[id] : undefined;
}

/**
 * Procura a próxima unidade viva na ordem. Ao completar a volta, inicia nova rodada.
 * Unidades que morrem no início do turno (fogo, Queimando) têm o turno encerrado
 * automaticamente; bonecos de teste encerram o próprio turno após os efeitos iniciais.
 */
function advanceToNextUnit(ctx: ResolutionContext): void {
  const { state } = ctx;
  // Proteção contra laços: cada iteração consome uma posição da ordem.
  for (let guard = 0; guard < state.turn.order.length * (state.maxRounds + 2) + 2; guard++) {
    if (state.status !== 'active') return;
    const order = state.turn.order;
    if (!order.some((id) => state.units[id]?.alive)) {
      state.turn.activeUnitId = null;
      return;
    }
    let next = state.turn.activeIndex + 1;
    if (next >= order.length) {
      next = 0;
      if (!startRound(ctx, state.turn.round + 1)) return;
    }
    state.turn.activeIndex = next;
    const unit = state.units[order[next]!];
    if (!unit?.alive) continue;
    startTurn(ctx, unit);
    if (state.status !== 'active') return;
    if (!unit.alive || unit.flags.isDummy) {
      onStatusesTurnEnd(ctx, unit);
      emit(ctx, 'TURN_ENDED', { unitId: unit.id, automatic: true });
      continue;
    }
    return;
  }
}

/** Retorna false se a partida terminou ao iniciar a rodada. */
function startRound(ctx: ResolutionContext, round: number): boolean {
  const { state } = ctx;
  if (round > state.maxRounds) {
    finishMatch(ctx, { kind: 'draw', reason: 'roundLimit' });
    return false;
  }
  state.turn.round = round;
  emit(ctx, 'ROUND_STARTED', { round });
  expireSurfaces(ctx);
  tickObjectCombustion(ctx);
  checkVictory(ctx);
  return state.status === 'active';
}

function startTurn(ctx: ResolutionContext, unit: Unit): void {
  const { state } = ctx;
  state.turn.turnId += 1;
  state.turn.activeUnitId = unit.id;
  // Novo turno global: o limite de dano por superfície recomeça para todos.
  state.surfaceHitsThisTurn = {};

  unit.ownTurnsStarted += 1;
  unit.usesThisTurn = {};
  unit.defendedThisTurn = false;
  emit(ctx, 'TURN_STARTED', { unitId: unit.id, ownTurn: unit.ownTurnsStarted });

  if (unit.shield && unit.ownTurnsStarted >= unit.shield.expiresAtOwnTurn) {
    emit(ctx, 'SHIELD_EXPIRED', { unitId: unit.id, amount: unit.shield.amount });
    unit.shield = null;
  }

  onStatusesTurnStart(ctx, unit);
  unit.ap = unit.maxAp;
  unit.mp = Math.max(0, unit.maxMp + mpModifier(ctx, unit));
  const focusBefore = unit.focus;
  unit.focus = Math.min(unit.maxFocus, unit.focus + FOCUS_REGEN_PER_TURN);
  if (unit.focus !== focusBefore) {
    emit(ctx, 'RESOURCE_RESTORED', { unitId: unit.id, resource: 'focus', requested: FOCUS_REGEN_PER_TURN, before: focusBefore, after: unit.focus });
  }
  exposeUnitToSurface(ctx, unit, 'turnStart');
  checkVictory(ctx);
}

/**
 * Vitória por eliminação; morte simultânea resulta em empate (seção 2.2).
 * Bonecos de teste não contam como equipe. Só há verificação com ao menos duas equipes.
 */
export function checkVictory(ctx: ResolutionContext): void {
  const { state } = ctx;
  if (state.status !== 'active') return;
  const combatants = Object.values(state.units).filter((u) => !u.flags.isDummy);
  const teams = new Set(combatants.map((u) => u.team));
  if (teams.size < 2) return;
  const alive = new Set(combatants.filter((u) => u.alive).map((u) => u.team));
  if (alive.size === 1) finishMatch(ctx, { kind: 'victory', winnerTeam: [...alive][0]!, reason: 'elimination' });
  else if (alive.size === 0) finishMatch(ctx, { kind: 'draw', reason: 'mutualDestruction' });
}

export function finishMatch(ctx: ResolutionContext, result: NonNullable<ResolutionContext['state']['result']>): void {
  if (ctx.state.status === 'finished') return;
  ctx.state.status = 'finished';
  ctx.state.result = result;
  ctx.state.turn.activeUnitId = null;
  emit(ctx, 'MATCH_ENDED', { result });
}
