/**
 * Rotas HTTP do servidor de jogo (Express do transporte do Colyseus):
 *
 *   GET  /health                       estado do processo e do banco
 *   POST /auth/login                   { username, password } → { token, account }
 *   GET  /rooms                        salas de partida abertas (lobby)
 *   GET  /debug/matches                (dev) partidas em memória e recentes no banco
 *   GET  /debug/matches/:id            (dev) estado oficial × visão de cada equipe × o que o
 *                                      cliente confirmou (modo NETWORK do Combat Debug Lab)
 *   GET  /debug/matches/:id/versions/:v (dev) estado oficial + eventos oficiais de uma versão
 *   GET  /debug/matches/:id/verify     (dev) replay do registro de comandos × snapshots
 */
import type { Application, NextFunction, Request, Response } from 'express';
import { matchMaker } from '@colyseus/core';
import { MATCH_ROOM, stateHash, type LoginResponse } from '@bardurinho/protocol';
import { verifyMatchReplay } from './modules/matches/replay.js';
import type { ServerServices } from './services.js';

const ROUTE_PREFIXES = ['/health', '/auth', '/rooms', '/debug'];

export function registerRoutes(app: Application, svc: ServerServices): void {
  // CORS só nas rotas próprias (o matchmaking do Colyseus cuida das dele).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!ROUTE_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    const origin = req.headers.origin;
    if (origin && svc.config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.get('/health', async (_req, res) => {
    const ok = await svc.db.query('SELECT 1 AS ok').then(() => true, () => false);
    res.json({ ok, db: svc.db.kind, rooms: svc.rooms.size, dev: svc.config.dev });
  });

  app.post('/auth/login', jsonBody, async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) {
      return void res.status(400).json({ error: 'Informe usuário e senha' });
    }
    const r = await svc.accounts.login(username, password);
    if (!r) return void res.status(401).json({ error: 'Usuário ou senha inválidos' });
    const body: LoginResponse = { token: r.token, account: r.account };
    res.json(body);
  });

  app.get('/rooms', async (_req, res) => {
    const rooms = await matchMaker.query({ name: MATCH_ROOM });
    res.json(rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, locked: r.locked, private: r.private, metadata: r.metadata })));
  });

  if (!svc.config.dev) return;

  app.get('/debug/matches', async (_req, res) => {
    const live = [...svc.rooms.values()].map((room) => ({
      matchId: room.session.id,
      roomId: room.roomId,
      status: room.session.state.status,
      version: room.session.version,
      round: room.session.state.turn.round,
      seats: room.session.seatInfo(),
      live: true,
    }));
    const recent = (await svc.matches.recent(20)).filter((m) => !svc.rooms.has(m.id)).map((m) => ({ matchId: m.id, roomId: m.roomId, status: m.status, live: false, result: m.result }));
    res.json({ live, recent });
  });

  app.get('/debug/matches/:id', async (req, res) => {
    const id = String(req.params.id);
    const room = svc.rooms.get(id);
    const commands = (await svc.matches.commands(id)).slice(-60);
    if (!room) {
      const snap = await svc.matches.snapshot(id);
      if (!snap) return void res.status(404).json({ error: 'Partida não encontrada' });
      return void res.json({ matchId: id, live: false, version: snap.version, official: snap.state, officialHash: snap.hash, seats: [], commands });
    }
    const s = room.session;
    res.json({
      matchId: s.id,
      roomId: room.roomId,
      live: true,
      version: s.version,
      seed: s.seed,
      turnSeconds: s.turnSeconds,
      timer: s.timerInfo(),
      official: s.state,
      officialHash: stateHash(s.state),
      seats: s.seats.map((seat) => {
        const p = s.projection(seat.team);
        return {
          seat: seat.seat,
          team: seat.team,
          username: seat.account?.username ?? null,
          connected: seat.connected,
          projection: p,
          sent: seat.sent,
          ack: seat.ack,
          inSync: !!seat.ack && !!seat.sent && seat.ack.version === seat.sent.version && seat.ack.hash === seat.sent.hash,
          divergences: seat.divergences,
          historyEvents: seat.history.length,
        };
      }),
      commands,
    });
  });

  app.get('/debug/matches/:id/versions/:version', async (req, res) => {
    const id = String(req.params.id);
    const version = Number(req.params.version);
    const snap = await svc.matches.snapshot(id, version);
    if (!snap) return void res.status(404).json({ error: 'Versão não encontrada' });
    res.json({ version, state: snap.state, hash: snap.hash, events: await svc.matches.eventsOfVersion(id, version) });
  });

  app.get('/debug/matches/:id/verify', async (req, res) => {
    res.json(await verifyMatchReplay(svc.matches, svc.catalog, String(req.params.id)));
  });
}

/** Corpo JSON pequeno (sem depender do body-parser do Express). */
function jsonBody(req: Request, res: Response, next: NextFunction): void {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    raw += chunk;
    if (raw.length > 8192) req.destroy();
  });
  req.on('end', () => {
    try {
      req.body = raw ? JSON.parse(raw) : {};
      next();
    } catch {
      res.status(400).json({ error: 'JSON inválido' });
    }
  });
}
