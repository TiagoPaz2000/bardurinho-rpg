/**
 * Fase 5 — ciclo completo no servidor (mesmo processo, PGlite em memória): cadastro, sessão,
 * personagem, loja (preço/saldo/posse/idempotência), equipar, partida contra bot até o fim,
 * recompensa idempotente calculada do resultado oficial, missões, histórico, fila de
 * matchmaking (dois jogadores), convite e proteção das salas reservadas.
 *
 * O lado "humano" é jogado por um `BotBrain` no cliente (mesmo `NetworkMatch` da interface,
 * só com a visão da própria equipe); o adversário é o bot do servidor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BotBrain, type BotDifficulty } from '@bardurinho/ai';
import { REWARD_TABLE, WELCOME_COINS, catalog, patioDasRuinas } from '@bardurinho/content';
import { Client } from '@colyseus/sdk';
import { createGameServer, type GameServer } from '../../apps/server/src/app.js';
import { verifyMatchReplay } from '../../apps/server/src/modules/matches/replay.js';
import { ApiError, GameApi } from '../../apps/web/src/network/api.js';
import { joinMatch } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';
import { exploreTargets } from '@bardurinho/ai';

let gs: GameServer;

beforeAll(async () => {
  process.env.BOT_DELAY_MS = '0';
  gs = await createGameServer({ port: 0, dataDir: 'memory', log: false, turnSeconds: 30, reconnectSeconds: 5, abandonSeconds: 60, botDelayMs: 0 });
}, 60_000);
afterAll(async () => {
  await gs?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | Promise<T>, ms = 10000, what = 'condição'): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`);
    await sleep(25);
  }
}

let n = 0;
async function newPlayer(classId = 'warrior') {
  const api = new GameApi(gs.url);
  const username = `jogador${Date.now().toString(36)}${n++}`;
  await api.register(username, 'segredo123', `Jogador ${n}`);
  const character = await api.createCharacter({ name: `Herói ${n}`, classId, accessoryId: 'accessory.vitality_amulet', consumables: ['consumable.health_potion', 'consumable.focus_potion'] });
  return { api, username, character };
}

/** Joga pelo cliente (NetworkMatch) até o fim, decidindo com a visão da própria equipe. */
async function playClient(nm: NetworkMatch, difficulty: BotDifficulty) {
  const brain = new BotBrain(catalog, nm.team, { difficulty, seed: 99, explore: exploreTargets(patioDasRuinas, nm.team) });
  const t0 = Date.now();
  while (nm.state.status !== 'finished') {
    if (Date.now() - t0 > 90_000) throw new Error('partida não terminou');
    const s = nm.state;
    if (s.status === 'active' && nm.canControl(s.turn.activeUnitId)) {
      const d = brain.decide(s);
      const r = await nm.execute(d.command);
      if (!r.ok) brain.rejectedCommand(d.command);
    } else await sleep(5);
  }
}

describe('Fase 5 — conta, sessão e personagem', () => {
  it('cadastro valida usuário/senha, recusa duplicado, abre sessão; login errado e logout', async () => {
    const api = new GameApi(gs.url);
    await expect(api.register('A', 'segredo123')).rejects.toThrow(/Usuário/);
    await expect(api.register('valido_1', '123')).rejects.toThrow(/senha/);
    const r = await api.register('valido_1', 'segredo123', 'Válido');
    expect(r.token).toBeTruthy();
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    await expect(new GameApi(gs.url).register('valido_1', 'outra-senha')).rejects.toThrow(/existe/);
    const me = await api.me();
    expect(me.account.coins).toBe(WELCOME_COINS);
    expect(me.account.friendCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(me.characters).toEqual([]);
    await expect(new GameApi(gs.url).login('valido_1', 'errada')).rejects.toThrow(/inválidos/);
    // A senha não fica em claro no banco.
    const row = await gs.services.db.query<{ password_hash: string }>('SELECT password_hash FROM accounts WHERE username = $1', ['valido_1']);
    expect(row[0]!.password_hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    const other = new GameApi(gs.url);
    await other.login('valido_1', 'segredo123');
    await other.logout();
    await expect(new GameApi(gs.url, other.token).me()).rejects.toThrow(); // token null
    const stale = new GameApi(gs.url, r.token);
    await api.logout();
    await expect(stale.me()).rejects.toMatchObject({ status: 401 });
  });

  it('personagem: nome, classe, aparência só com cosméticos possuídos, limite e seleção', async () => {
    const api = new GameApi(gs.url);
    await api.register(`pers${Date.now().toString(36)}`, 'segredo123');
    await expect(api.createCharacter({ name: 'x', classId: 'mage' })).rejects.toThrow(/nome/);
    await expect(api.createCharacter({ name: 'Merlin', classId: 'bardo' })).rejects.toThrow(/classe/);
    await expect(api.createCharacter({ name: 'Merlin', classId: 'mage', appearance: { color: 'color.gold' } })).rejects.toThrow(/não possui/);
    const c = await api.createCharacter({ name: 'Merlin', classId: 'mage', appearance: { color: 'color.ruby', outfit: 'outfit.standard' }, consumables: ['consumable.oil_flask', 'consumable.oil_flask', 'consumable.focus_potion'] });
    expect(c.appearance.color).toBe('color.ruby');
    expect(c.consumables).toEqual(['consumable.oil_flask', 'consumable.focus_potion']);
    await expect(api.createCharacter({ name: 'merlin', classId: 'rogue' })).rejects.toThrow(/nome/);
    const c2 = await api.createCharacter({ name: 'Sombra', classId: 'rogue' });
    let me = await api.me();
    expect(me.account.activeCharacterId).toBe(c2.id);
    me = await api.selectCharacter(c.id);
    expect(me.account.activeCharacterId).toBe(c.id);
    await api.createCharacter({ name: 'Terceiro', classId: 'druid' });
    await expect(api.createCharacter({ name: 'Quarto', classId: 'warrior' })).rejects.toThrow(/Limite/);
    await expect(api.updateCharacter(c.id, { classId: 'warrior' } as never)).rejects.toThrow(/não podem/);
  });
});

describe('Fase 5 — loja, moedas e inventário', () => {
  it('compra validada no servidor: preço do catálogo, saldo, posse e repetição do requestId', async () => {
    const { api, character } = await newPlayer();
    const shop = await api.shop();
    const gold = shop.find((x) => x.id === 'color.gold')!;
    expect(gold.price).toBe(50);
    expect(shop.every((x) => x.price > 0)).toBe(true);
    // Cosmético não possuído não pode ser equipado.
    await expect(api.updateCharacter(character.id, { appearance: { color: 'color.gold' } })).rejects.toThrow(/não possui/);
    const req = 'compra-0001-teste';
    const b1 = await api.buy('color.gold', req);
    expect(b1).toMatchObject({ ok: true, balance: WELCOME_COINS - 50, duplicate: false });
    const again = await api.buy('color.gold', req);
    expect(again).toMatchObject({ ok: true, duplicate: true, balance: WELCOME_COINS - 50 });
    const owned = await api.buy('color.gold', 'compra-0002-teste');
    expect(owned).toMatchObject({ ok: false, error: 'Você já possui este item', balance: 50 });
    const poor = await api.buy('outfit.spectral', 'compra-0003-teste');
    expect(poor).toMatchObject({ ok: false, error: 'Moedas insuficientes', balance: 50 });
    await expect(api.buy('frame.gold', 'compra-0004-teste')).rejects.toThrow(/venda/); // recompensa de missão
    await expect(api.buy('color.violet', 'x')).rejects.toThrow(/requestId/);
    const me = await api.me();
    expect(me.account.coins).toBe(50);
    expect(me.inventory).toEqual(['color.gold']);
    const eq = await api.updateCharacter(character.id, { appearance: { color: 'color.gold', portrait: 'portrait.class' }, accessoryId: 'accessory.frost_medallion' });
    expect(eq.appearance.color).toBe('color.gold');
    expect(eq.accessoryId).toBe('accessory.frost_medallion');
    await expect(api.updateCharacter(character.id, { accessoryId: 'weapon.iron_sword' })).rejects.toThrow(/Acessório/);
    const ledger = await gs.services.profiles.ledger(me.account.id);
    expect(ledger.map((l) => [l.reason, l.delta, l.balanceAfter])).toEqual([
      ['purchase', -50, 50],
      ['welcome', WELCOME_COINS, WELCOME_COINS],
    ]);
  });
});

describe('Fase 5 — partida contra bot, recompensa, missões e histórico', () => {
  it('jogador × bot (servidor) até o fim; recompensa uma vez só; missões e histórico atualizados', async () => {
    const { api, character } = await newPlayer('mage');
    const before = (await api.me()).account.coins;
    await expect(api.playBot('impossivel')).rejects.toThrow(/Dificuldade/);
    const { roomId } = await api.playBot('easy');
    await expect(api.playBot('easy')).rejects.toThrow(/partida/); // já tem uma pendente
    const status = await api.lobbyStatus();
    expect(status.match).toEqual({ roomId, mode: 'bot' });
    const joined = await joinMatch(gs.url, api.token!, { roomId });
    const nm = new NetworkMatch(catalog, joined.room, joined.snapshot);
    expect(nm.team).toBe('A');
    const seat = joined.snapshot.seats.find((s) => s.team === 'A')!;
    expect(seat.character).toMatchObject({ name: character.name });
    expect(joined.snapshot.seats.find((s) => s.team === 'B')!.bot).toBe('easy');
    await waitFor(() => nm.state.status === 'active', 8000, 'início');
    // Personagem da conta na partida: classe, nome, acessório e consumíveis.
    const mine = Object.values(nm.state.units).find((u) => u.team === 'A')!;
    expect(mine).toMatchObject({ classId: 'mage', name: character.name, accessoryId: 'accessory.vitality_amulet', maxHp: 88 });
    // Nada do bot vaza antes de ser visto.
    expect(Object.values(nm.state.units).every((u) => u.team === 'A')).toBe(true);
    await playClient(nm, 'hard');
    const reward = await waitFor(() => nm.rewards, 8000, 'recompensa');
    const official = gs.services.rooms.get(nm.matchId)?.session.state ?? null;
    const result = (await gs.services.matches.result(nm.matchId))!;
    const outcome = !result.winnerTeam ? 'draw' : result.winnerTeam === 'A' ? 'victory' : 'defeat';
    expect(reward.outcome).toBe(outcome);
    expect(reward.coins).toBe(REWARD_TABLE.bot[outcome]);
    // Missões: "Concluir três partidas" 1/3, "Partida do dia" concluída (+20).
    const three = reward.missions.find((m) => m.id === 'mission.complete_three')!;
    expect(three).toMatchObject({ before: 0, after: 1, completedNow: false });
    expect(reward.missions.find((m) => m.id === 'daily.play_one')).toMatchObject({ completedNow: true, reward: { coins: 20 } });
    expect(reward.missionCoins).toBeGreaterThanOrEqual(20);
    expect(reward.balance).toBe(before + reward.coins + reward.missionCoins);
    if (outcome === 'victory') expect(reward.unlocked).toContain('frame.gold');
    // Idempotente: fechar a mesma partida de novo não credita.
    const again = await gs.services.progression.settleMatch(nm.matchId, 'bot', official ?? nm.state, await gs.services.matches.events(nm.matchId), [{ accountId: (await api.me()).account.id, team: 'A' }]);
    expect([...again.values()][0]).toEqual(reward);
    expect((await api.me()).account.coins).toBe(reward.balance);
    expect(await api.reward(nm.matchId)).toEqual(reward);
    const missions = await api.missions();
    expect(missions.find((m) => m.id === 'mission.complete_three')).toMatchObject({ progress: 1, completed: false });
    expect(missions.find((m) => m.id === 'daily.play_one')).toMatchObject({ progress: 1, completed: true });
    const history = await api.history();
    expect(history[0]).toMatchObject({ matchId: nm.matchId, mode: 'bot', botDifficulty: 'easy', outcome, coins: reward.coins, character: { name: character.name, classId: 'mage' }, opponent: { username: 'bot-facil' } });
    // Os comandos do bot passaram pela mesma validação e ficaram no registro; o replay confere.
    const cmds = await gs.services.matches.commands(nm.matchId);
    const botCmds = cmds.filter((c) => c.seat === 1 && c.authorKind === 'player');
    expect(botCmds.length).toBeGreaterThan(3);
    expect(botCmds.filter((c) => !c.accepted).length).toBeLessThanOrEqual(2);
    expect((await verifyMatchReplay(gs.services.matches, catalog, nm.matchId)).ok).toBe(true);
    await joined.room.leave();
  }, 120_000);

  it('cliente não consegue criar sala com assentos reservados (sem a chave interna)', async () => {
    const { api } = await newPlayer();
    const me = await api.me();
    const client = new Client(gs.url);
    const room = await client.create('arena', { token: api.token, mode: 'bot', botDifficulty: 'easy', internal: 'chute', reserved: [{ seat: 0, account: { id: me.account.id }, choice: { classId: 'mage' } }] });
    await sleep(100);
    const session = [...gs.services.rooms.values()].find((r) => r.roomId === room.roomId)!.session;
    expect(session.mode).toBe('custom');
    expect(session.seats.some((s) => s.bot)).toBe(false);
    await room.leave();
  });
});

describe('Fase 5 — matchmaking e convites', () => {
  it('fila junta dois jogadores numa partida PvP; ambos recebem a recompensa da tabela', async () => {
    const p1 = await newPlayer('warrior');
    const p2 = await newPlayer('rogue');
    await expect(new GameApi(gs.url, p1.api.token).joinQueue()).resolves.toMatchObject({ queue: { size: 1 } });
    const s2 = await p2.api.joinQueue();
    const s1 = await p1.api.lobbyStatus();
    expect(s1.match?.mode).toBe('pvp');
    expect(s2.match?.roomId ?? (await p2.api.lobbyStatus()).match?.roomId).toBe(s1.match!.roomId);
    const roomId = s1.match!.roomId;
    // Uma terceira conta não entra na sala reservada.
    const intruder = await newPlayer();
    await expect(joinMatch(gs.url, intruder.api.token!, { roomId })).rejects.toThrow();
    const j1 = await joinMatch(gs.url, p1.api.token!, { roomId });
    const j2 = await joinMatch(gs.url, p2.api.token!, { roomId });
    const m1 = new NetworkMatch(catalog, j1.room, j1.snapshot);
    const m2 = new NetworkMatch(catalog, j2.room, j2.snapshot);
    expect(new Set([m1.team, m2.team])).toEqual(new Set(['A', 'B']));
    await waitFor(() => m1.state.status === 'active' && m2.state.status === 'active', 8000, 'início PvP');
    await Promise.all([playClient(m1, 'normal'), playClient(m2, 'normal')]);
    const [r1, r2] = await Promise.all([waitFor(() => m1.rewards, 8000, 'recompensa 1'), waitFor(() => m2.rewards, 8000, 'recompensa 2')]);
    expect(r1.coins).toBe(REWARD_TABLE.pvp[r1.outcome]);
    expect(r2.coins).toBe(REWARD_TABLE.pvp[r2.outcome]);
    if (r1.outcome === 'victory') expect(r2.outcome).toBe('defeat');
    const h = await p2.api.history();
    expect(h[0]).toMatchObject({ mode: 'pvp', opponent: { username: p1.username } });
    await j1.room.leave();
    await j2.room.leave();
  }, 150_000);

  it('convite por código de amigo → partida privada para os dois', async () => {
    const p1 = await newPlayer();
    const p2 = await newPlayer('druid');
    const code = (await p2.api.me()).account.friendCode;
    await expect(p1.api.invite('ninguem-aqui')).rejects.toThrow(/não encontrado/);
    await expect(p1.api.invite(p1.username)).rejects.toThrow(/si mesmo/);
    const inv = await p1.api.invite(code.toLowerCase());
    expect(inv.to.username).toBe(p2.username);
    const incoming = (await p2.api.lobbyStatus()).invites.incoming;
    expect(incoming.map((i) => i.id)).toEqual([inv.id]);
    await expect(p1.api.acceptInvite(inv.id)).rejects.toThrow(/não encontrado/); // só o convidado aceita
    const { roomId } = await p2.api.acceptInvite(inv.id);
    expect((await p1.api.lobbyStatus()).match).toEqual({ roomId, mode: 'private' });
    const j1 = await joinMatch(gs.url, p1.api.token!, { roomId });
    const j2 = await joinMatch(gs.url, p2.api.token!, { roomId });
    const m1 = new NetworkMatch(catalog, j1.room, j1.snapshot);
    await waitFor(() => m1.state.status === 'active', 8000, 'início privado');
    // Recusar / cancelar
    const inv2 = await p2.api.invite(p1.username);
    await p2.api.cancelInvite(inv2.id);
    expect((await p1.api.lobbyStatus()).invites.incoming).toEqual([]);
    await j1.room.leave();
    await j2.room.leave();
  }, 60_000);

  it('erro de API: sem personagem não entra na fila', async () => {
    const api = new GameApi(gs.url);
    await api.register(`semp${Date.now().toString(36)}`, 'segredo123');
    const e = await api.joinQueue().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(409);
  });
});
