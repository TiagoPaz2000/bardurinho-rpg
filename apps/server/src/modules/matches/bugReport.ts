/**
 * Fase 6: relatório de bug de uma partida — tudo o que é preciso para reproduzi-la no core:
 * snapshot 0 (estado oficial antes do START_MATCH, com a semente dos dados), comandos aceitos na
 * ordem (de jogadores, do cronômetro e do servidor), recusados (contexto) e o hash final.
 * `npm run regression:from-match` transforma isto num cenário de tests/scenarios (Combat Debug Lab).
 */
import type { GameplayCommand } from '@bardurinho/domain';
import { BUG_REPORT_FORMAT, type BugReport } from '@bardurinho/protocol';
import type { MatchesRepository } from '../../db/repositories.js';

export async function buildBugReport(repo: MatchesRepository, matchId: string): Promise<BugReport | null> {
  const m = await repo.get(matchId);
  const initial = await repo.snapshot(matchId, 0);
  const last = await repo.snapshot(matchId);
  if (!m || !initial || !last) return null;
  const commands = await repo.commands(matchId);
  return {
    format: BUG_REPORT_FORMAT,
    matchId,
    mapId: m.mapId,
    seed: m.seed,
    status: m.status,
    result: m.result,
    rulesVersion: initial.state.rulesVersion,
    contentVersion: initial.state.contentVersion,
    initial: { version: 0, state: initial.state, hash: initial.hash },
    commands: commands
      .filter((c) => c.accepted)
      .map((c) => ({ versionAfter: c.versionAfter!, authorKind: c.authorKind, seat: c.seat, turnId: c.turnId, command: c.payload as GameplayCommand })),
    rejected: commands.filter((c) => !c.accepted).map((c) => ({ seq: c.seq, seat: c.seat, turnId: c.turnId, payload: c.payload, error: c.error })),
    final: { version: last.version, hash: last.hash },
    players: (await repo.players(matchId)).map((p) => ({ seat: p.seat, team: p.team })),
    exportedAt: new Date().toISOString(),
  };
}
