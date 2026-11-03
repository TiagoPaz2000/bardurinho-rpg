/**
 * Conferência da persistência: refaz a partida a partir do snapshot inicial e do registro de
 * comandos aceitos e compara cada estado com o snapshot salvo daquela versão. Prova que o
 * banco tem tudo para reconstruir o resultado oficial (determinismo + persistência).
 */
import { applyCommand, type Catalog, type GameplayCommand } from '@bardurinho/domain';
import { stateHash } from '@bardurinho/protocol';
import type { MatchesRepository } from '../../db/repositories.js';

export interface ReplayReport {
  ok: boolean;
  versions: number;
  commands: number;
  events: { persisted: number; replayed: number };
  finalHash: string | null;
  persistedFinalHash: string | null;
  result: unknown;
  mismatches: Array<{ version: number; expected: string; got: string }>;
  errors: string[];
}

export async function verifyMatchReplay(repo: MatchesRepository, catalog: Catalog, matchId: string): Promise<ReplayReport> {
  const errors: string[] = [];
  const mismatches: ReplayReport['mismatches'] = [];
  const initial = await repo.snapshot(matchId, 0);
  const last = await repo.snapshot(matchId);
  if (!initial || !last) return { ok: false, versions: 0, commands: 0, events: { persisted: 0, replayed: 0 }, finalHash: null, persistedFinalHash: null, result: null, mismatches, errors: ['partida sem snapshot'] };
  const accepted = (await repo.commands(matchId)).filter((c) => c.accepted);
  const persistedEvents = (await repo.events(matchId)).length;
  let state = initial.state;
  let replayed = 0;
  for (const c of accepted) {
    const r = applyCommand(state, catalog, c.payload as GameplayCommand, {});
    if (!r.ok) {
      errors.push(`v${c.versionAfter}: comando recusado no replay (${r.error.code})`);
      break;
    }
    state = r.state;
    replayed += r.events.length;
    const snap = await repo.snapshot(matchId, c.versionAfter!);
    const got = stateHash(state);
    if (!snap || snap.hash !== got) mismatches.push({ version: c.versionAfter!, expected: snap?.hash ?? '(ausente)', got });
  }
  const finalHash = stateHash(state);
  const result = await repo.result(matchId);
  if (result && result.finalHash !== finalHash) errors.push('hash do resultado ≠ replay');
  if (replayed !== persistedEvents) errors.push(`eventos: ${persistedEvents} salvos, ${replayed} no replay`);
  return {
    ok: errors.length === 0 && mismatches.length === 0 && finalHash === last.hash,
    versions: last.version,
    commands: accepted.length,
    events: { persisted: persistedEvents, replayed },
    finalHash,
    persistedFinalHash: last.hash,
    result: result?.result ?? null,
    mismatches,
    errors,
  };
}
