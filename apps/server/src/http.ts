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
 *   Fase 7 (teste externo): /playtest/config, /telemetry/*, /feedback/*, /lobby/rematch, /admin/*
 *   (ver packages/protocol/src/playtest.ts e adminRoutes.ts) e o cliente web de produção como
 *   arquivos estáticos (STATIC_DIR) na mesma porta.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { matchMaker } from '@colyseus/core';
import { BUG_CATEGORIES, MATCH_ROOM, PLAY_AGAIN, parseTelemetryBatch, sanitizeProps, stateHash, type LoginResponse, type MeResponse, type PlaytestConfigDto } from '@bardurinho/protocol';
import { InviteCodeError } from './db/accounts.js';
import { markActiveDay } from './db/playtest.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { WELCOME_COINS, passwordProblem, usernameProblem } from '@bardurinho/content';
import type { Account } from './db/repositories.js';
import { LobbyError } from './modules/lobby/LobbyService.js';
import { verifyMatchReplay } from './modules/matches/replay.js';
import { buildBugReport } from './modules/matches/bugReport.js';
import { ProgressionError } from './modules/progression/ProgressionService.js';
import { RateLimiter } from './modules/security/RateLimiter.js';
import { metrics } from './metrics.js';
import type { ServerServices } from './services.js';

const ROUTE_PREFIXES = ['/health', '/auth', '/rooms', '/debug', '/me', '/characters', '/shop', '/missions', '/matches', '/lobby', '/playtest', '/telemetry', '/feedback', '/admin'];

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

/**
 * IP do pedido (limites por IP): o endereço do socket. Fase 7: atrás de um túnel/proxy reverso
 * (`TRUST_PROXY=1`) vale o primeiro endereço de `X-Forwarded-For` — senão todos os testadores
 * chegariam com o IP do túnel e dividiriam o mesmo limite. Nunca é gravado no banco.
 */
let trustProxy = false;
const clientIp = (req: Request): string => {
  const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() : '';
  return fwd || (req.socket.remoteAddress ?? 'desconhecido');
};

export function registerRoutes(app: Application, svc: ServerServices): void {
  // Fase 6: limites de autenticação (força bruta / cadastro em massa).
  trustProxy = svc.config.trustProxy;
  const rl = svc.config.rateLimit;
  const loginFailures = new RateLimiter(rl.loginFailuresPerUser, 5 * 60_000);
  const loginPerIp = new RateLimiter(rl.loginPerIpPerMinute, 60_000);
  const registerPerIp = new RateLimiter(rl.registerPerIpPer10Min, 10 * 60_000);
  // Fase 7: telemetria e relatórios de bug também têm teto (lixo/abuso não enche o banco).
  // Atrás de um túnel todos chegam pelo mesmo IP: o teto é folgado (≈ 30 testadores enviando a cada 10 s).
  const telemetryPerIp = new RateLimiter(rl.loginPerIpPerMinute ? 1200 : 0, 60_000);
  const bugsPerAccount = new RateLimiter(rl.loginPerIpPerMinute ? 10 : 0, 10 * 60_000);
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
    res.json({ ok, db: svc.db.kind, rooms: svc.rooms.size, dev: svc.config.dev, build: svc.build });
  });

  // Fase 7: o que o cliente precisa saber antes do login (consentimento, convite, versão).
  app.get('/playtest/config', (_req, res) => {
    const body: PlaytestConfigDto = { playtest: svc.config.playtest, registration: svc.config.registration, build: svc.build, contentVersion: svc.catalog.contentVersion };
    res.json(body);
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
    const { username, password, displayName, inviteCode } = (req.body ?? {}) as Record<string, unknown>;
    const ip = clientIp(req);
    if (!registerPerIp.hit(ip)) return tooMany(res, registerPerIp.retryAfter(ip), 'cadastro');
    // Fase 7: grupo controlado — cadastro fechado ou só com código de convite.
    if (svc.config.registration === 'closed') return void res.status(403).json({ error: 'Cadastro fechado neste servidor' });
    const problem = usernameProblem(username) ?? passwordProblem(password);
    if (problem) return void res.status(400).json({ error: problem });
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 24) : String(username);
    const code = typeof inviteCode === 'string' && inviteCode.trim() ? inviteCode : null;
    let account;
    try {
      account = await svc.accounts.register(String(username), String(password), name, WELCOME_COINS, { code, required: svc.config.registration === 'invite' });
    } catch (err) {
      if (err instanceof InviteCodeError) return void res.status(403).json({ error: err.message });
      throw err;
    }
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

  app.get('/me', authed(svc, async (_req, _res, a) => {
    // Fase 7: dia ativo (retorno D1/D7).
    if (a.kind === 'player') await markActiveDay(svc.db, a.id).catch(() => undefined);
    return me(svc, a.id);
  }));

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

  // ---------------------------------------------------------------------------
  // Fase 7: revanche, telemetria (com consentimento), pesquisa e bug
  // ---------------------------------------------------------------------------

  app.post('/lobby/rematch', jsonBody, authed(svc, (req, _res, a) => svc.lobby.rematch(a, (req.body as Record<string, unknown>)?.matchId)));

  app.post('/telemetry/events', jsonBodyOf(32 * 1024), async (req, res) => {
    if (!svc.config.playtest) return void res.status(404).json({ error: 'Telemetria desligada' });
    const ip = clientIp(req);
    if (!telemetryPerIp.hit(ip)) return tooMany(res, telemetryPerIp.retryAfter(ip), 'envio');
    const parsed = parseTelemetryBatch(req.body);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    try {
      const token = bearer(req);
      const account = token ? await svc.accounts.bySession(token) : null;
      const analyticsId = account && account.kind !== 'bot' ? await svc.playtest.analyticsId(account.id) : null;
      const accepted = await svc.playtest.insertEvents(parsed.batch, analyticsId);
      res.status(202).json({ ok: true, accepted });
    } catch (err) {
      svc.log(`[telemetria] ${String(err)}`);
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  app.post('/telemetry/consent', jsonBody, authed(svc, async (req, _res, a) => {
    const consent = (req.body as Record<string, unknown>)?.consent;
    if (typeof consent !== 'boolean') throw new ProgressionError('Informe consent: true/false');
    await svc.playtest.setConsent(a.id, consent);
    return { ok: true };
  }));

  app.post('/feedback/survey', jsonBody, authed(svc, async (req, res, a) => {
    if (!svc.config.playtest) return void res.status(404).json({ error: 'Pesquisa desligada' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const matchId = typeof b.matchId === 'string' && b.matchId.length <= 64 ? b.matchId : '';
    const seat = matchId
      ? (await svc.db.query<{ team: string; class_id: string | null }>("SELECT team, character->>'classId' AS class_id FROM match_players WHERE match_id = $1 AND account_id = $2", [matchId, a.id]))[0]
      : undefined;
    if (!seat) throw new ProgressionError('Partida não encontrada', 404);
    const scale = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
    const fun = scale(b.fun, 1, 5);
    if (fun === null) throw new ProgressionError('Dê uma nota de diversão de 1 a 5');
    const m = await svc.matches.get(matchId);
    const info = await svc.matches.mode(matchId);
    const r = m?.result;
    const outcome = !r ? null : r.kind === 'victory' ? (r.winnerTeam === seat.team ? 'victory' : 'defeat') : 'draw';
    const playAgain = (PLAY_AGAIN as readonly unknown[]).includes(b.playAgain) ? (b.playAgain as string) : null;
    const analyticsId = (await svc.playtest.analyticsId(a.id))!;
    const inserted = await svc.playtest.insertSurvey({
      matchId,
      analyticsId,
      mode: info?.mode ?? null,
      botDifficulty: info?.botDifficulty ?? null,
      outcome,
      classId: seat.class_id,
      fun,
      clarity: scale(b.clarity, 1, 5),
      camera: scale(b.camera, 1, 5),
      balance: scale(b.balance, -2, 2),
      botRating: info?.mode === 'bot' ? scale(b.botRating, 1, 5) : null,
      playAgain,
      comment: cleanText(b.comment, 500),
      build: typeof b.build === 'string' ? b.build.slice(0, 64) : null,
    });
    return { ok: true, duplicate: !inserted };
  }));

  app.post('/feedback/bug', jsonBody, authed(svc, async (req, res, a) => {
    if (!svc.config.playtest) return void res.status(404).json({ error: 'Relatório de bug desligado' });
    if (!bugsPerAccount.hit(a.id)) return tooMany(res, bugsPerAccount.retryAfter(a.id), 'relatório de bug');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const description = cleanText(b.description, 2000);
    if (!description || description.length < 3) throw new ProgressionError('Descreva o problema em poucas palavras');
    const category = (BUG_CATEGORIES as readonly unknown[]).includes(b.category) ? (b.category as string) : 'outro';
    let matchId: string | null = typeof b.matchId === 'string' && b.matchId.length <= 64 ? b.matchId : null;
    // O relatório da partida (Fase 6) só é anexado se a conta jogou nela; fica só no servidor.
    let report: unknown = null;
    if (matchId) {
      const players = await svc.matches.players(matchId);
      if (players.some((p) => p.accountId === a.id)) report = await buildBugReport(svc.matches, matchId);
      else matchId = null;
    }
    const id = await svc.playtest.insertBug({
      analyticsId: await svc.playtest.analyticsId(a.id),
      matchId,
      category,
      description,
      client: sanitizeProps(b.client),
      report,
      build: typeof b.build === 'string' ? b.build.slice(0, 64) : null,
    });
    svc.log(`[feedback] bug ${id.slice(0, 8)} (${category})${report ? ' com relatório da partida' : ''}`);
    return { ok: true, id, attached: !!report };
  }));

  registerAdminRoutes(app, svc);

  // Fase 7: cliente web de produção (vite build) na mesma porta — um endereço só para o teste.
  if (svc.config.staticDir) {
    const dir = resolve(svc.config.staticDir);
    // Texto (JS de ~8 MB, HTML, JSON) comprimido uma vez em memória: faz diferença num túnel.
    const gz = new Map<string, Buffer>();
    app.use((req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next();
      let rel: string;
      try {
        rel = decodeURIComponent(req.path);
      } catch {
        return next();
      }
      if (rel.endsWith('/')) rel += 'index.html';
      if (!/\.(js|css|html|json|svg|txt)$/.test(rel)) return next();
      const file = resolve(dir, `.${rel}`);
      if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
      let buf = gz.get(file);
      if (!buf) gz.set(file, (buf = gzipSync(readFileSync(file))));
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', rel.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
      res.type(extname(file));
      res.send(buf);
    });
    app.use(
      express.static(dir, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (res, path) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Referrer-Policy', 'no-referrer');
          if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

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

/** Texto livre do jogador: sem caracteres de controle (exceto quebra de linha), limitado. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
  return s || null;
}

/** Corpo JSON pequeno (sem depender do body-parser do Express). */
function jsonBody(req: Request, res: Response, next: NextFunction): void {
  readJson(req, res, next, 8192);
}

/** Fase 7: o mesmo com outro limite (lotes de telemetria). Aceita qualquer Content-Type (sendBeacon). */
function jsonBodyOf(limit: number) {
  return (req: Request, res: Response, next: NextFunction): void => readJson(req, res, next, limit);
}

function readJson(req: Request, res: Response, next: NextFunction, limit: number): void {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    raw += chunk;
    if (raw.length > limit) req.destroy();
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
