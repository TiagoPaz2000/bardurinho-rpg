/**
 * Montagem do servidor de jogo: banco + migrações + contas de desenvolvimento + Colyseus
 * (WebSocket) + rotas HTTP. `createGameServer` é usado por `main.ts` e, no mesmo processo,
 * pelos testes de integração (porta 0 = porta livre qualquer).
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { MATCH_ROOM } from '@bardurinho/protocol';
import { MatchRoom } from './adapters/colyseus/MatchRoom.js';
import { loadConfig, type ServerConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrations.js';
import { ProfileRepository } from './db/profile.js';
import { AccountsRepository, MatchesRepository } from './db/repositories.js';
import { LobbyService } from './modules/lobby/LobbyService.js';
import { ProgressionService } from './modules/progression/ProgressionService.js';
import { registerRoutes } from './http.js';
import type { ServerServices } from './services.js';

export interface GameServer {
  port: number;
  url: string;
  services: ServerServices;
  close(): Promise<void>;
}

export async function createGameServer(overrides: Partial<ServerConfig> = {}): Promise<GameServer> {
  const config = loadConfig(process.env, overrides);
  const log = (msg: string) => {
    if (config.log) console.log(`[servidor] ${msg}`);
  };
  const db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
  const applied = await migrate(db);
  if (applied.length) log(`migrações aplicadas: ${applied.join(', ')}`);
  const accounts = new AccountsRepository(db);
  for (const a of config.devAccounts) await accounts.ensure(a.username, a.displayName, a.password);
  // Fase 5: contas de sistema dos bots (assento nas partidas contra bot; sem login).
  const botAccounts = {
    easy: await accounts.ensure('bot-facil', 'Bot fácil', '', 'bot'),
    normal: await accounts.ensure('bot-normal', 'Bot normal', '', 'bot'),
    hard: await accounts.ensure('bot-dificil', 'Bot difícil', '', 'bot'),
  };
  const profiles = new ProfileRepository(db);
  const matches = new MatchesRepository(db);
  // Fase 6: salas não sobrevivem ao reinício — as partidas que ficaram abertas são encerradas
  // como `aborted` (sem resultado nem recompensa), em vez de ficarem `active` para sempre.
  const stale = await matches.abortStale();
  if (stale) log(`${stale} partida(s) do processo anterior encerrada(s) como 'aborted'`);
  const services = {
    config,
    db,
    accounts,
    matches,
    profiles,
    progression: new ProgressionService(db, profiles, catalog),
    botAccounts,
    internalKey: randomBytes(18).toString('base64url'),
    rng: Math.random,
    catalog,
    map: patioDasRuinas,
    rooms: new Map(),
    log,
  } as Omit<ServerServices, 'lobby'> as ServerServices;
  services.lobby = new LobbyService(services);
  MatchRoom.services = services;

  const transport = new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    express: (app) => registerRoutes(app, services),
  });
  // Fase 4: "Procurar partida" só junta salas do mesmo formato (1 × 1 / 2 × 2).
  server.define(MATCH_ROOM, MatchRoom).filterBy(['teamSize']);
  await server.listen(config.port, config.host);
  const http = (transport as unknown as { server: import('node:http').Server }).server;
  const port = (http.address() as AddressInfo).port;
  log(`ouvindo em http://${config.host}:${port} (banco: ${db.kind}${db.kind === 'pglite' ? ` em ${config.dataDir}` : ''}; turno ${config.turnSeconds} s; dev ${config.dev ? 'ligado' : 'desligado'})`);

  let closed = false;
  return {
    port,
    url: `http://${config.host}:${port}`,
    services,
    async close() {
      if (closed) return;
      closed = true;
      for (const room of services.rooms.values()) room.session.dispose();
      await server.gracefullyShutdown(false).catch(() => undefined);
      await db.close().catch(() => undefined);
    },
  };
}
