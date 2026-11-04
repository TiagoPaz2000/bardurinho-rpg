/**
 * Rotas HTTP do servidor de jogo (Express do transporte do Colyseus):
 *
 *   GET  /health                       estado do processo e do banco
 *   POST /auth/login                   { username, password } → { token, account }
 *   GET  /rooms                        salas de partida abertas (lobby de desenvolvimento)
 *   Fase 5 (conta, personagem, loja, missões, histórico, lobby): ver packages/protocol/src/api.ts
 *   GET  /debug/matches                (dev) partidas em memória e recentes no banco
 *   GET  /debug/matches/:id            (dev) estado oficial × visão de cada equipe × o que o
 *                                      cliente confirmou (modo NETWORK do Combat Debug Lab)
 *   GET  /debug/matches/:id/versions/:v (dev) estado oficial + eventos oficiais de uma versão
 *   GET  /debug/matches/:id/verify     (dev) replay do registro de comandos × snapshots
 *   GET  /debug/matches/:id/export     (dev, Fase 6) relatório de bug: snapshot 0 + comandos aceitos
 *                                      (vira cenário de regressão no Combat Debug Lab)
 *   GET  /debug/metrics                (dev, Fase 6) tempos do core/banco/envio, memória, divergências
 */
import type { Application, NextFunction, Request, Response } from 'express';
import { matchMaker } from '@colyseus/core';
import { MATCH_ROOM, stateHash, type LoginResponse, type MeResponse } from '@bardurinho/protocol';
import { WELCOME_COINS, passwordProblem, usernameProblem } from '@bardurinho/content';
import type { Account } from './db/repositories.js';
import { LobbyError } from './modules/lobby/LobbyService.js';
import { verifyMatchReplay } from './modules/matches/replay.js';
import { buildBugReport } from './modules/matches/bugReport.js';
import { ProgressionError } from './modules/progression/ProgressionService.js';
import { RateLimiter } from './modules/security/RateLimiter.js';
import { metrics } from './metrics.js';
import type { ServerServices } from './services.js';

const ROUTE_PREFIXES = ['/health', '/auth', '/rooms', '/debug', '/me', '/characters', '/shop', '/missions', '/matches', '/lobby'];

/** Token da sessão: `Authorization: Bearer <token>`. */
const bearer = (req: Request): string => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

type Authed = (req: Request, res: Response, account: Account) => Promise<unknown>;

/** Rota autenticada: sessão válida; erros de regra (400/404/409) viram `{ error }`. */
const authed = (svc: ServerServices, fn: Authed) => async (req: Request, res: Response) => {
  try {
    const account = await svc.accounts.bySession(bearer(req));
    if (!account) return void res.status(401).json({ error: 'Sessão inválida ou expirada: faça login novamente' });
    const out = await fn(req, res, account);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof ProgressionError || err instanceof LobbyError) return void res.status(err.status).json({ error: err.message });
    svc.log(`[http] ${req.method} ${req.path}: ${String(err)}`);
    if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
  }
};

async function me(svc: ServerServices, accountId: string): Promise<MeResponse> {
  const a = (await svc.profiles.account(accountId))!;
  return {
    account: { id: a.id, username: a.username, displayName: a.displayName, friendCode: a.friendCode, coins: a.coins, activeCharacterId: a.activeCharacterId },
    characters: await svc.profiles.characters(accountId),
    inventory: await svc.profiles.inventory(accountId),
  };
}

/** IP do pedido (sem proxy reverso no MVP: o endereço do socket). */
const clientIp = (req: Request): string => req.socket.remoteAddress ?? 'desconhecido';

export function registerRoutes(app: Application, svc: ServerServices): void {
  // Fase 6: limites de autenticação (força bruta / cadastro em massa).
  const rl = svc.config.rateLimit;
  const loginFailures = new RateLimiter(rl.loginFailuresPerUser, 5 * 60_000);
  const loginPerIp = new RateLimiter(rl.loginPerIpPerMinute, 60_000);
  const registerPerIp = new RateLimiter(rl.registerPerIpPer10Min, 10 * 60_000);
  const tooMany = (res: Response, seconds: number, what: string) => {
    res.setHeader('Retry-After', String(seconds));
    res.status(429).json({ error: `Muitas tentativas de ${what}: tente de novo em ${seconds} s` });
  };

  // CORS só nas rotas próprias (o matchmaking do Colyseus cuida das dele).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!ROUTE_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    const origin = req.headers.origin;
    if (origin && svc.config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
    const ip = clientIp(req);
    const userKey = username.trim().toLowerCase();
    if (!loginPerIp.hit(ip)) return tooMany(res, loginPerIp.retryAfter(ip), 'login');
    if (loginFailures.blocked(userKey)) {
      svc.log(`[conta] login de ${userKey} bloqueado (falhas demais)`);
      return tooMany(res, loginFailures.retryAfter(userKey), 'login');
    }
    const r = await svc.accounts.login(username, password);
    if (!r) {
      loginFailures.hit(userKey);
      return void res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
    loginFailures.reset(userKey);
    const body: LoginResponse = { token: r.token, account: r.account, expiresAt: r.expiresAt };
    res.json(body);
  });

  // ---------------------------------------------------------------------------
  // Fase 5: conta, personagem, inventário, loja, missões, histórico, lobby
  // ---------------------------------------------------------------------------

  app.post('/auth/register', jsonBody, async (req, res) => {
    const { username, password, displayName } = (req.body ?? {}) as Record<string, unknown>;
    const ip = clientIp(req);
    if (!registerPerIp.hit(ip)) return tooMany(res, registerPerIp.retryAfter(ip), 'cadastro');
    const problem = usernameProblem(username) ?? passwordProblem(password);
    if (problem) return void res.status(400).json({ error: problem });
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 24) : String(username);
    const account = await svc.accounts.register(String(username), String(password), name, WELCOME_COINS);
    if (!account) return void res.status(409).json({ error: 'Esse usuário já existe' });
    const session = await svc.accounts.openSession(account.id);
    svc.log(`[conta] cadastro de ${account.username}`);
    const body: LoginResponse = { token: session.token, expiresAt: session.expiresAt, account: { id: account.id, username: account.username, displayName: account.displayName } };
    res.status(201).json(body);
  });

  app.post('/auth/logout', async (req, res) => {
    await svc.accounts.logout(bearer(req));
    res.json({ ok: true });
  });

  app.get('/me', authed(svc, (_req, _res, a) => me(svc, a.id)));

  app.post('/characters', jsonBody, authed(svc, async (req, res, a) => {
    const c = await svc.progression.createCharacter(a.id, (req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(c);
  }));
  app.patch('/characters/:id', jsonBody, authed(svc, (req, _res, a) => svc.progression.updateCharacter(a.id, String(req.params.id), (req.body ?? {}) as Record<string, unknown>)));
  app.post('/characters/:id/select', authed(svc, async (req, _res, a) => {
    if (!(await svc.profiles.selectCharacter(a.id, String(req.params.id)))) throw new ProgressionError('Personagem não encontrado', 404);
    return me(svc, a.id);
  }));

  app.get('/shop', authed(svc, (_req, _res, a) => svc.progression.shop(a.id)));
  app.post('/shop/buy', jsonBody, authed(svc, async (req, res, a) => {
    const { productId, requestId } = (req.body ?? {}) as Record<string, unknown>;
    const r = await svc.progression.buy(a.id, productId, requestId);
    res.status(r.ok ? 200 : 409).json(r);
  }));

  app.get('/missions', authed(svc, (_req, _res, a) => svc.progression.missions(a.id)));
  app.get('/matches/history', authed(svc, (_req, _res, a) => svc.profiles.history(a.id)));
  app.get('/matches/:id/reward', authed(svc, async (req, res, a) => {
    const r = await svc.profiles.reward(String(req.params.id), a.id);
    if (!r) return void res.status(404).json({ error: 'Recompensa ainda não calculada' });
    return r;
  }));

  app.get('/lobby/status', authed(svc, (_req, _res, a) => svc.lobby.status(a)));
  app.post('/lobby/bot', jsonBody, authed(svc, async (req, _res, a) => ({ roomId: await svc.lobby.playBot(a, (req.body as Record<string, unknown>)?.difficulty) })));
  app.post('/lobby/queue', authed(svc, async (_req, _res, a) => {
    await svc.lobby.enqueue(a);
    return svc.lobby.status(a);
  }));
  app.delete('/lobby/queue', authed(svc, async (_req, _res, a) => {
    svc.lobby.leaveQueue(a.id);
    return svc.lobby.status(a);
  }));
  app.post('/lobby/invites', jsonBody, authed(svc, (req, _res, a) => svc.lobby.invite(a, (req.body as Record<string, unknown>)?.to)));
  app.post('/lobby/invites/:id/accept', authed(svc, async (req, _res, a) => ({ roomId: await svc.lobby.accept(a, String(req.params.id)) })));
  app.post('/lobby/invites/:id/decline', authed(svc, async (req, _res, a) => {
    svc.lobby.respond(a, String(req.params.id), 'decline');
    return svc.lobby.status(a);
  }));
  app.post('/lobby/invites/:id/cancel', authed(svc, async (req, _res, a) => {
    svc.lobby.respond(a, String(req.params.id), 'cancel');
    return svc.lobby.status(a);
  }));

  app.get('/rooms', async (_req, res) => {
    const rooms = await matchMaker.query({ name: MATCH_ROOM });
    res.json(rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, locked: r.locked, private: r.private, metadata: r.metadata })));
  });

  if (!svc.config.dev) return;

  // Fase 6: métricas do processo (teste de carga). `POST /debug/metrics/reset` zera.
  app.get('/debug/metrics', (_req, res) => {
    const seats = [...svc.rooms.values()].flatMap((r) => r.session.seats);
    res.json({ ...metrics.snapshot(), rooms: svc.rooms.size, divergences: seats.reduce((n, s) => n + s.divergences.length, 0), db: svc.db.kind });
  });
  app.post('/debug/metrics/reset', (_req, res) => {
    metrics.reset();
    res.json({ ok: true });
  });

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

  app.get('/debug/matches/:id/export', async (req, res) => {
    const report = await buildBugReport(svc.matches, String(req.params.id));
    if (!report) return void res.status(404).json({ error: 'Partida não encontrada' });
    res.setHeader('Content-Disposition', `attachment; filename="partida-${report.matchId.slice(0, 8)}.bug.json"`);
    res.json(report);
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
