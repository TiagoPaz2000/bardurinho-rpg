/**
 * Fase 6: formato do relatório de bug de uma partida (servidor → Combat Debug Lab / testes).
 * Gerado por `GET /debug/matches/:id/export`; convertido em cenário de regressão por
 * `npm run regression:from-match` ou aberto direto no Lab ("Importar initial.json / relatório").
 */
import type { GameplayCommand, GameState, MatchResult } from '@bardurinho/domain';

export const BUG_REPORT_FORMAT = 'bardurinho.bug-report/1';

export interface BugReport {
  format: typeof BUG_REPORT_FORMAT;
  matchId: string;
  mapId: string;
  seed: number;
  status: string;
  result: MatchResult | null;
  rulesVersion: number;
  contentVersion: string;
  /** Estado oficial na versão 0 (antes do START_MATCH), com a semente dos dados. */
  initial: { version: 0; state: GameState; hash: string };
  /** Comandos aceitos, na ordem (jogadores, cronômetro e servidor). */
  commands: Array<{ versionAfter: number; authorKind: string; seat: number | null; turnId: number; command: GameplayCommand }>;
  /** Comandos recusados (contexto do bug; não entram no replay). */
  rejected: Array<{ seq: number; seat: number | null; turnId: number; payload: unknown; error: unknown }>;
  final: { version: number; hash: string };
  players: Array<{ seat: number; team: string }>;
  exportedAt: string;
}

export const isBugReport = (v: unknown): v is BugReport => typeof v === 'object' && v !== null && (v as { format?: unknown }).format === BUG_REPORT_FORMAT;
