/**
 * Serviços compartilhados pelo servidor (injeção simples, sem framework).
 */
import type { MapDefinition } from '@bardurinho/content';
import type { Catalog } from '@bardurinho/domain';
import type { ServerConfig } from './config.js';
import type { Database } from './db/database.js';
import type { AccountsRepository, MatchesRepository } from './db/repositories.js';
import type { MatchRoom } from './adapters/colyseus/MatchRoom.js';

export interface ServerServices {
  config: ServerConfig;
  db: Database;
  accounts: AccountsRepository;
  matches: MatchesRepository;
  catalog: Catalog;
  map: MapDefinition;
  /** Salas ativas por matchId (rotas de debug). */
  rooms: Map<string, MatchRoom>;
  log: (msg: string) => void;
}
