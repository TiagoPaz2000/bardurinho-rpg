/**
 * Servidor de jogo (Fase 3) no mesmo processo: Colyseus + PGlite em memória + dois clientes
 * reais (@colyseus/sdk) usando o mesmo `NetworkMatch` do cliente web.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import { listTargetCells, type GameState } from '@bardurinho/domain';
import { PROTOCOL_VERSION, stateHash, type ServerMessages } from '@bardurinho/protocol';
import { Client } from '@colyseus/sdk';
import { createGameServer, type GameServer } from '../../apps/server/src/app.js';
import { verifyMatchReplay } from '../../apps/server/src/modules/matches/replay.js';
import type { MatchRoom } from '../../apps/server/src/adapters/colyseus/MatchRoom.js';
import { MatchSession } from '../../apps/server/src/modules/matches/MatchSession.js';
import { joinMatch, login, waitSnapshot } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';

let gs: GameServer;

beforeAll(async () => {
  gs = await createGameServer({ port: 0, dataDir: 'memory', log: false, turnSeconds: 60, reconnectSeconds: 2, abandonSeconds: 60 });
}, 60_000);
afterAll(async () => {
  await gs?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 8000, what = 'condição'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`);
    await sleep(20);
  }
}

type Raw = Array<{ type: string; msg: unknown }>;
function capture(room: import('@colyseus/sdk').Room, raw: Raw) {
  for (const t of ['snapshot', 'update', 'result', 'presence'] as Array<keyof ServerMessages>) room.onMessage(t, (msg: unknown) => raw.push({ type: t, msg }));
}

type TeamChoice = Array<{ classId: string; accessoryId?: string | null; consumables?: string[] }>;
async function pair(opts: { seed?: number; turnSeconds?: number; teamSize?: number; teamA?: TeamChoice; teamB?: TeamChoice } = {}) {
  const ta = (await login(gs.url, 'jogador-a', 'dev')).token;
  const tb = (await login(gs.url, 'jogador-b', 'dev')).token;
  const rawA: Raw = [];
  const rawB: Raw = [];
  const A = await joinMatch(gs.url, ta, { create: true, seed: opts.seed ?? 11, ...(opts.turnSeconds ? { turnSeconds: opts.turnSeconds } : {}), ...(opts.teamSize ? { teamSize: opts.teamSize } : {}), ...(opts.teamA ? { team: opts.teamA } : {}) });
  rawA.push({ type: 'snapshot', msg: A.snapshot });
  const a = new NetworkMatch(catalog, A.room, A.snapshot);
  capture(A.room, rawA);
  const B = await joinMatch(gs.url, tb, { roomId: A.room.roomId, ...(opts.teamB ? { team: opts.teamB } : {}) });
  rawB.push({ type: 'snapshot', msg: B.snapshot });
  const b = new NetworkMatch(catalog, B.room, B.snapshot);
  capture(B.room, rawB);
  const room = [...gs.services.rooms.values()].find((r) => r.roomId === A.room.roomId) as MatchRoom;
  const session = room.session;
  await waitFor(() => session.state.status === 'active' && a.version === session.version && b.version === session.version, 8000, 'início da partida');
  const byTeam = (team: string) => (a.team === team ? a : b);
  const active = () => byTeam(session.state.units[session.state.turn.activeUnitId!]!.team);
  const idle = () => (active() === a ? b : a);
  /** Os dois clientes já aplicaram a versão oficial atual. */
  const synced = () => waitFor(() => a.version === session.version && b.version === session.version, 5000, 'clientes na versão oficial');
  return { A, B, a, b, ta, tb, rawA, rawB, room, session, active, idle, synced };
}

const projHash = (s: { projection(team: string): { hash: string } }, team: string) => s.projection(team).hash;

describe('servidor autoritativo (Colyseus + PGlite)', () => {
  it('dois jogadores entram, o servidor inicia a partida e cada um vê só a sua equipe', async () => {
    const p = await pair();
    expect(p.a.team).toBe('A');
    expect(p.b.team).toBe('B');
    expect(Object.keys(p.a.state.units)).toEqual(['warrior-01']);
    expect(Object.keys(p.b.state.units)).toEqual(['mage-01']);
    // Nenhum payload enviado ao A contém o personagem oculto nem a semente dos dados.
    for (const { msg } of p.rawA) {
      const json = JSON.stringify(msg);
      expect(json).not.toContain('"id":"mage-01"');
      const st = (msg as { state?: GameState }).state;
      if (st) expect(st.rng.seed).toBe(0);
    }
    // Estados sem divergência: hash do cliente = hash da projeção oficial.
    expect(stateHash(p.a.state)).toBe(projHash(p.session, 'A'));
    expect(stateHash(p.b.state)).toBe(projHash(p.session, 'B'));
    await waitFor(() => p.session.seats.every((s) => s.ack?.version === p.session.version), 3000, 'acks');
    expect(p.session.seats.every((s) => s.divergences.length === 0)).toBe(true);
    await p.A.room.leave();
    await p.B.room.leave();
  });

  it('commandId repetido não é reaplicado; comando fora do turno e de outra equipe são recusados', async () => {
    const p = await pair();
    const active = p.active();
    const idle = p.idle();
    const activeId = p.session.state.turn.activeUnitId!;
    const idleUnit = Object.values(idle.state.units)[0]!.id;
    // Fora do turno (o personagem é do jogador, mas não é a vez dele).
    const wrong = await idle.execute({ type: 'END_TURN', actorId: idleUnit });
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error.code).toBe('WRONG_TURN');
    // Personagem da outra equipe.
    const foreign = await idle.execute({ type: 'END_TURN', actorId: activeId });
    expect(!foreign.ok && foreign.error.code).toBe('NOT_YOUR_UNIT');

    const v0 = p.session.version;
    const envelope = { type: 'DEFEND', actorId: activeId, protocolVersion: PROTOCOL_VERSION, commandId: 'dup-1' };
    const first = await active.sendRaw(envelope);
    expect(first.ok).toBe(true);
    expect(p.session.version).toBe(v0 + 1);
    const hp = p.session.state.units[activeId]!.shield;
    // Mesmo commandId: resposta repetida, nada reaplicado (o DEFEND seria recusado por já ter defendido).
    const raw = p.active() === p.a ? p.rawA : p.rawB;
    const before = raw.length;
    const again = await active.sendRaw(envelope);
    expect(again.ok).toBe(true);
    await sleep(100);
    const res = raw.slice(before).find((r) => r.type === 'result')!.msg as { duplicate: boolean; ok: boolean };
    expect(res).toMatchObject({ duplicate: true, ok: true });
    expect(p.session.version).toBe(v0 + 1);
    expect(p.session.state.units[activeId]!.shield).toEqual(hp);
    // O outro jogador não consegue "roubar" o commandId.
    const stolen = await idle.sendRaw({ ...envelope, actorId: idleUnit });
    expect(!stolen.ok && stolen.error.code).toBe('DUPLICATE_COMMAND');
    // Banco: um só registro do commandId.
    const rows = await gs.services.db.query<{ n: number }>("SELECT count(*)::int AS n FROM match_commands WHERE match_id = $1 AND command_id = 'dup-1'", [p.session.id]);
    expect(rows[0]!.n).toBe(1);
    await p.A.room.leave();
    await p.B.room.leave();
  });

  it('comandos inválidos são recusados: formato, campos extras, debug, START_MATCH e linha de visão no servidor', async () => {
    const p = await pair();
    const active = p.active();
    const actorId = p.session.state.turn.activeUnitId!;
    const send = (extra: Record<string, unknown>) => active.sendRaw({ protocolVersion: PROTOCOL_VERSION, commandId: `bad-${Math.random()}`, ...extra });
    const code = (r: Awaited<ReturnType<typeof send>>) => (r.ok ? 'ok' : r.error.code);
    expect(code(await send({ type: 'BASIC_ATTACK', actorId, weaponId: 'weapon.iron_sword', target: { kind: 'self' }, damage: 999 }))).toBe('INVALID_FORMAT');
    expect(code(await send({ type: 'DEBUG_SET_UNIT', unitId: actorId, patch: { hp: 999 } }))).toBe('COMMAND_NOT_ALLOWED');
    expect(code(await send({ type: 'START_MATCH' }))).toBe('COMMAND_NOT_ALLOWED');
    expect(code(await send({ type: 'MOVE', actorId, to: { x: 999, y: 0, floor: 0 } }))).toBe('INVALID_FORMAT');
    expect(code(await active.sendRaw({ type: 'END_TURN', actorId, protocolVersion: 99, commandId: 'v99' }))).toBe('UNSUPPORTED_PROTOCOL');
    expect(code(await send({ type: 'END_TURN', actorId, expectedTurnId: 0 }))).toBe('STALE_TURN');
    // Mover para longe demais: o core recusa (alcance de PM).
    expect(code(await send({ type: 'MOVE', actorId, to: { x: 15, y: 8, floor: 0 } }))).not.toBe('ok');
    // Linha de visão validada no servidor: célula no alcance, atrás do muro.
    const official = p.session.state;
    const unit = official.units[actorId]!;
    const weapon = unit.weapons[0]!;
    void listTargetCells;
    // Mirar diretamente o inimigo oculto pelo id: o servidor não deixa (e o cliente nem o conhece).
    const enemy = Object.values(official.units).find((u) => u.team !== unit.team)!;
    expect(code(await send({ type: 'BASIC_ATTACK', actorId, weaponId: weapon, target: { kind: 'entity', id: enemy.id } }))).not.toBe('ok');
    // Nada disso mudou o estado oficial.
    expect(p.session.version).toBe(1);
    const rejected = await gs.services.db.query<{ n: number }>('SELECT count(*)::int AS n FROM match_commands WHERE match_id = $1 AND NOT accepted', [p.session.id]);
    expect(rejected[0]!.n).toBeGreaterThanOrEqual(7);
    await p.A.room.leave();
    await p.B.room.leave();
  });

  it('linha de visão validada no servidor: ataque atrás do muro é recusado (NO_LINE_OF_SIGHT)', async () => {
    const a = await gs.services.accounts.byUsername('jogador-a');
    const b = await gs.services.accounts.byUsername('jogador-b');
    const session = new MatchSession({
      roomId: 'teste-los',
      mapId: 'teste',
      scenario: {
        map: { floors: [['.....', '..#..', '.....']] },
        units: [
          { id: 'mago', classId: 'mage', team: 'A', pos: { x: 2, y: 0 } },
          { id: 'guerreiro', classId: 'warrior', team: 'B', pos: { x: 2, y: 2 } },
          { id: 'ladino', classId: 'rogue', team: 'B', pos: { x: 0, y: 0 } },
        ],
        order: ['mago', 'guerreiro', 'ladino'],
        initiative: 'fixed',
      },
      catalog,
      repo: gs.services.matches,
      seed: 5,
      turnSeconds: 60,
      send: () => undefined,
    });
    await session.claimSeat(a!);
    await session.claimSeat(b!);
    expect((await session.start()).ok).toBe(true);
    const cmd = (target: unknown) => ({ protocolVersion: PROTOCOL_VERSION, commandId: `los-${Math.random()}`, type: 'BASIC_ATTACK', actorId: 'mago', weaponId: 'weapon.arcane_wand', target });
    const blocked = await session.submit(0, cmd({ kind: 'cell', x: 2, y: 2, floor: 0 }));
    expect(!blocked.ok && blocked.error.code).toBe('NO_LINE_OF_SIGHT');
    // Com linha de visão (o ladino, na mesma linha do mago) o mesmo ataque é aceito.
    const ok = await session.submit(0, cmd({ kind: 'cell', x: 0, y: 0, floor: 0 }));
    expect(ok).toMatchObject({ ok: true });
    session.dispose();
  });

  it('persistência: comandos, eventos, snapshots e resultado; o replay do registro reproduz o estado', async () => {
    const p = await pair({ seed: 21 });
    for (let i = 0; i < 4; i++) {
      await p.synced();
      const who = p.active();
      const r = await who.execute({ type: 'END_TURN', actorId: who.state.turn.activeUnitId! });
      expect(r).toMatchObject({ ok: true });
    }
    await p.synced();
    const loser = p.active();
    const r = await loser.execute({ type: 'SURRENDER', actorId: loser.state.turn.activeUnitId! });
    expect(r.ok).toBe(true);
    await waitFor(() => p.a.state.status === 'finished' && p.b.state.status === 'finished', 5000, 'fim nos clientes');
    const id = p.session.id;
    const m = await gs.services.matches.get(id);
    expect(m?.status).toBe('finished');
    const res = await gs.services.matches.result(id);
    expect(res?.winnerTeam).toBe(loser === p.a ? 'B' : 'A');
    expect(res?.commands).toBe(6); // START_MATCH + 4 END_TURN + SURRENDER
    const snaps = await gs.services.db.query<{ n: number }>('SELECT count(*)::int AS n FROM match_snapshots WHERE match_id = $1', [id]);
    expect(snaps[0]!.n).toBe(p.session.version + 1);
    const events = await gs.services.matches.events(id);
    expect(events.length).toBeGreaterThan(10);
    expect(events.at(-1)!.type).toBe('MATCH_ENDED');
    const players = await gs.services.matches.players(id);
    expect(players.map((x) => x.team)).toEqual(['A', 'B']);
    const report = await verifyMatchReplay(gs.services.matches, catalog, id);
    expect(report.ok).toBe(true);
    expect(report.finalHash).toBe(res!.finalHash);
    // O resultado que os clientes veem é o do servidor.
    expect(p.a.state.result).toEqual(p.session.state.result);
    expect(p.b.state.result).toEqual(p.session.state.result);
    await p.A.room.leave();
    await p.B.room.leave();
  });

  it('reconexão: quem cai perde atualizações e volta com um snapshot igual à projeção oficial', async () => {
    const p = await pair({ seed: 31 });
    const B = p.B.room;
    const token = B.reconnectionToken;
    B.reconnection.enabled = false;
    void B.leave(false); // queda sem consentimento: vaga reservada
    await waitFor(() => !p.session.seats[1]!.connected, 3000, 'queda');
    // O jogo continua sem o B.
    for (let i = 0; i < 2; i++) {
      const s = p.session.state;
      const team = s.units[s.turn.activeUnitId!]!.team;
      if (team === 'A') await p.a.execute({ type: 'END_TURN', actorId: s.turn.activeUnitId! });
      else await p.session.expireTurn(s.turn.turnId); // vez do B (desconectado): o cronômetro encerraria
    }
    expect(p.b.version).toBeLessThan(p.session.version);
    const client = new Client(gs.url);
    const room = await client.reconnect(token);
    const snap = await waitSnapshot(room);
    expect(snap.reason).toBe('reconnect');
    expect(snap.version).toBe(p.session.version);
    expect(snap.hash).toBe(projHash(p.session, 'B'));
    const b2 = new NetworkMatch(catalog, room, snap);
    expect(stateHash(b2.state)).toBe(projHash(p.session, 'B'));
    expect(p.session.seats[1]!.connected).toBe(true);
    // Reserva expirada (2 s nos testes): a conta volta ao mesmo assento pela sala.
    room.reconnection.enabled = false;
    void room.leave(false);
    await sleep(2600);
    const again = await joinMatch(gs.url, p.tb, { roomId: p.A.room.roomId });
    expect(again.snapshot.seat).toBe(1);
    expect(again.snapshot.hash).toBe(projHash(p.session, 'B'));
    // Terceira conta não entra numa sala cheia.
    await gs.services.accounts.ensure('intruso', 'Intruso', 'dev');
    const ti = (await login(gs.url, 'intruso', 'dev')).token;
    await expect(joinMatch(gs.url, ti, { roomId: p.A.room.roomId })).rejects.toThrow();
    await p.A.room.leave();
    await again.room.leave();
  }, 20_000);

  it('cronômetro: turno esgotado é encerrado pelo servidor (comando do autor "timer")', async () => {
    const p = await pair({ seed: 41, turnSeconds: 0.4 });
    const turn0 = p.session.state.turn.turnId;
    expect(p.a.secondsLeft()).not.toBeNull();
    await waitFor(() => p.session.state.turn.turnId >= turn0 + 2, 5000, 'turnos automáticos');
    await waitFor(() => p.a.version === p.session.version, 3000, 'atualização no cliente');
    const rows = await gs.services.db.query<{ n: number }>("SELECT count(*)::int AS n FROM match_commands WHERE match_id = $1 AND author_kind = 'timer' AND accepted", [p.session.id]);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
    expect(stateHash(p.a.state)).toBe(projHash(p.session, 'A'));
    p.session.dispose();
    await p.A.room.leave();
    await p.B.room.leave();
  });
});

describe('escolha de personagens em rede (Fase 4)', () => {
  it('2 × 2: cada assento escolhe classes/acessório/consumíveis; o servidor valida, monta e persiste o snapshot 0', async () => {
    const p = await pair({
      seed: 41,
      teamSize: 2,
      teamA: [{ classId: 'rogue', accessoryId: 'accessory.vitality_amulet', consumables: ['consumable.oil_flask'] }, { classId: 'druid' }],
      // Inválidos: classe desconhecida (vira a padrão da posição), item repetido e acessório errado.
      teamB: [{ classId: 'warrior', accessoryId: 'weapon.dagger', consumables: ['consumable.health_potion', 'consumable.health_potion'] }, { classId: 'paladino' }, { classId: 'mage' }],
    });
    const units = p.session.state.units;
    // Fase 6: ids opacos no servidor (a ordem de iniciativa não revela a classe).
    expect(Object.keys(units).sort()).toEqual(['unit-a1', 'unit-a2', 'unit-b1', 'unit-b2']);
    expect(units['unit-a1']).toMatchObject({ classId: 'rogue', team: 'A', maxHp: 98, consumables: ['consumable.oil_flask'] });
    expect(units['unit-a2']).toMatchObject({ classId: 'druid', team: 'A' });
    expect(units['unit-b1']).toMatchObject({ classId: 'warrior', team: 'B', accessoryId: null, consumables: ['consumable.health_potion'] });
    expect(units['unit-b2']).toMatchObject({ classId: 'druid', team: 'B' });
    // Cada cliente só controla e só recebe (no início) a própria equipe.
    await p.synced();
    expect(Object.keys(p.a.state.units).sort()).toEqual(['unit-a1', 'unit-a2']);
    expect(Object.keys(p.b.state.units).sort()).toEqual(['unit-b1', 'unit-b2']);
    expect(p.a.canControl('unit-a1') && !p.a.canControl('unit-b1')).toBe(true);
    // Snapshot 0 = montagem final (o replay parte dele).
    const loser = p.active();
    expect((await loser.execute({ type: 'SURRENDER', actorId: loser.state.turn.activeUnitId! })).ok).toBe(true);
    await waitFor(() => p.session.state.status === 'finished', 5000, 'fim');
    const report = await verifyMatchReplay(gs.services.matches, catalog, p.session.id);
    expect(report.ok).toBe(true);
    const initial = await gs.services.matches.snapshot(p.session.id, 0);
    expect(Object.keys(initial!.state.units).sort()).toEqual(['unit-a1', 'unit-a2', 'unit-b1', 'unit-b2']);
    await p.A.room.leave();
    await p.B.room.leave();
  });
});
