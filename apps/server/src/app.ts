/**
 * Montagem do servidor de jogo: banco + migrações + contas de desenvolvimento + Colyseus
 * (WebSocket) + rotas HTTP. `createGameServer` é usado por `main.ts` e, no mesmo processo,
 * pelos testes de integração (porta 0 = porta livre qualquer).
 */
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { MATCH_ROOM } from '@bardurinho/protocol';
import { MatchRoom } from './adapters/colyseus/MatchRoom.js';
import { loadConfig, type ServerConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrations.js';
import { AccountsRepository, MatchesRepository } from './db/repositories.js';
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

  const services: ServerServices = { config, db, accounts, matches: new MatchesRepository(db), catalog, map: patioDasRuinas, rooms: new Map(), log };
  MatchRoom.services = services;

  const transport = new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    express: (app) => registerRoutes(app, services),
  });
  server.define(MATCH_ROOM, MatchRoom);
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
