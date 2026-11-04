/**
 * Serviços compartilhados pelo servidor (injeção simples, sem framework).
 */
import type { BotDifficultyId, MapDefinition } from '@bardurinho/content';
import type { Catalog } from '@bardurinho/domain';
import type { ServerConfig } from './config.js';
import type { Database } from './db/database.js';
import type { ProfileRepository } from './db/profile.js';
import type { Account, AccountsRepository, MatchesRepository } from './db/repositories.js';
import type { MatchRoom } from './adapters/colyseus/MatchRoom.js';
import type { LobbyService } from './modules/lobby/LobbyService.js';
import type { ProgressionService } from './modules/progression/ProgressionService.js';

export interface ServerServices {
  config: ServerConfig;
  db: Database;
  accounts: AccountsRepository;
  matches: MatchesRepository;
  /** Fase 5: personagens, inventário, moedas, missões, recompensas, histórico. */
  profiles: ProfileRepository;
  progression: ProgressionService;
  lobby: LobbyService;
  /** Contas de sistema dos bots (uma por dificuldade). */
  botAccounts: Record<BotDifficultyId, Account>;
  /** Chave das salas criadas pelo próprio servidor (assentos reservados); nunca sai do processo. */
  internalKey: string;
  /** Sorteios do servidor que não são regra de jogo (classe do bot). */
  rng: () => number;
  catalog: Catalog;
  map: MapDefinition;
  /** Salas ativas por matchId (rotas de debug). */
  rooms: Map<string, MatchRoom>;
  log: (msg: string) => void;
}
