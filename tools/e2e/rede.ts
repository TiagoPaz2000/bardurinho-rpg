/**
 * E2E da Fase 3 (critério de aprovação): dois clientes locais completam uma partida pelo
 * servidor autoritativo, sem divergência de estado e sem o cliente controlar resultados.
 *
 *   npm run e2e:rede            (sobe um servidor próprio na porta 2568, banco PGlite novo
 *                                em tests/output/e2e-rede/pg; não precisa do `npm run server`)
 *   E2E_SEED=7 npm run e2e:rede
 *
 * Os dois clientes usam o mesmo código do cliente web (`network/connect.ts` +
 * `NetworkMatch`), sem Babylon. Cada robô decide só com a visão da própria equipe: anda até o
 * inimigo (última posição conhecida ou o canto dele) e ataca quando há uma ação válida.
 *
 * Conferências:
 *  - a cada versão, hash do estado de cada cliente = hash enviado pelo servidor (`inSync`);
 *  - depois: para TODA versão, o estado/eventos que cada cliente recebeu = projeção recalculada
 *    a partir do estado oficial persistido (o servidor não mandou nada além da visão da equipe;
 *    nenhum personagem oculto vazou), e o hash final de cada cliente = projeção oficial final;
 *  - tentativas de trapaça recusadas: fora do turno, personagem alheio, commandId repetido,
 *    campo "dano" forjado, comando de debug, START_MATCH, alvo oculto por id;
 *  - queda e reconexão do B no meio da partida (snapshot = projeção oficial);
 *  - resultado: decidido pelo servidor (MATCH_ENDED nos eventos oficiais), persistido, e o
 *    replay do registro de comandos reproduz o hash final.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalog } from '@bardurinho/content';
import {
  distance,
  findPath,
  computeTeamVision,
  listActionsOnTarget,
  projectEventsForTeam,
  projectStateForClient,
  reachableCells,
  type Coord,
  type GameEvent,
  type GameplayCommand,
  type GameState,
} from '@bardurinho/domain';
import { PROTOCOL_VERSION, stableStringify, stateHash, type UpdateMessage } from '@bardurinho/protocol';
import { Client } from '@colyseus/sdk';
import { joinMatch, login, waitSnapshot } from '../../apps/web/src/network/connect.js';
import { NetworkMatch } from '../../apps/web/src/network/NetworkMatch.js';

const PORT = Number(process.env.E2E_PORT ?? 2568);
const URL_ = `http://127.0.0.1:${PORT}`;
const SEED = Number(process.env.E2E_SEED ?? 7);
const OUT = resolve('tests/output/e2e-rede');
const MAX_COMMANDS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? '  ok ' : '  FALHOU'} ${what}`);
};
async function waitFor(cond: () => boolean, ms: number, what: string) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(15);
  }
}
const getJson = async <T>(path: string): Promise<T> => (await (await fetch(URL_ + path)).json()) as T;

// ---------------------------------------------------------------------------
// Servidor próprio
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: `${OUT}/pg`, TURN_SECONDS: '30', RECONNECT_SECONDS: '30', GAME_LOG: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog: string[] = [];
server.stdout.on('data', (d: Buffer) => serverLog.push(d.toString()));
server.stderr.on('data', (d: Buffer) => serverLog.push(d.toString()));
const stopServer = () => {
  try {
    server.kill();
  } catch {
    /* já saiu */
  }
};
process.on('exit', stopServer);

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${URL_}/health`)).ok) break;
  } catch {
    /* subindo */
  }
  if (i > 120) throw new Error('servidor não subiu:\n' + serverLog.join(''));
  await sleep(250);
}
console.log(`servidor em ${URL_} (PGlite em ${OUT}/pg), semente ${SEED}`);

// ---------------------------------------------------------------------------
// Dois clientes
// ---------------------------------------------------------------------------
const t0 = Date.now();
const ta = (await login(URL_, 'jogador-a', 'dev')).token;
const tb = (await login(URL_, 'jogador-b', 'dev')).token;
const JA = await joinMatch(URL_, ta, { create: true, seed: SEED });
const a = new NetworkMatch(catalog, JA.room, JA.snapshot);
const JB = await joinMatch(URL_, tb, { roomId: JA.room.roomId });
let b = new NetworkMatch(catalog, JB.room, JB.snapshot);
const matchId = a.matchId;
console.log(`partida ${matchId} na sala ${JA.room.roomId}`);

/** Tudo o que cada cliente recebeu (para a conferência com o oficial no fim). */
const received: Record<'A' | 'B', Map<number, UpdateMessage>> = { A: new Map(), B: new Map() };
const recordUpdates = (team: 'A' | 'B', room: typeof JA.room) => room.onMessage('update', (m: UpdateMessage) => received[team].set(m.version, m));
recordUpdates('A', JA.room);
recordUpdates('B', JB.room);
let outOfSync = 0;
const watchSync = (m: NetworkMatch) => m.onChange(() => (m.status.inSync ? undefined : outOfSync++));
watchSync(a);
watchSync(b);

const serverVersion = async () => (await getJson<{ version: number }>(`/debug/matches/${matchId}`)).version;
const synced = async () => {
  const v = await serverVersion();
  await waitFor(() => a.version >= v && b.version >= v && !a.busy && !b.busy, 8000, `clientes na versão ${v}`);
};
await waitFor(() => a.state.status === 'active' && b.state.status === 'active', 8000, 'início');

const clients = () => [a, b];
const activeClient = () => clients().find((c) => c.canControl(c.state.turn.activeUnitId)) ?? null;

// ---------------------------------------------------------------------------
// Robô (só com a visão da própria equipe)
// ---------------------------------------------------------------------------
const lastSeen = new Map<string, Coord>();
const enemyStart: Record<string, Coord> = { A: { x: 8, y: 15, floor: 0 }, B: { x: 7, y: 0, floor: 0 } };

/** Custo do caminho até uma célula adjacente ao objetivo (o objetivo pode estar ocupado). */
function costTo(state: GameState, from: Coord, goal: Coord): number {
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const n = { x: goal.x + dx, y: goal.y + dy, floor: goal.floor };
      if (distance(n, goal) > 1) continue; // adjacente pela distância do jogo (diagonal conta mais)
      if (n.x === from.x && n.y === from.y && n.floor === from.floor) return 0;
      const p = findPath(state, catalog, from, n);
      if (p) best = Math.min(best, p.cost);
    }
  return best;
}

async function playTurn(c: NetworkMatch): Promise<number> {
  let commands = 0;
  // Ritmo mínimo entre comandos (um cliente real anima cada resultado; o servidor limita mensagens/s).
  const pace = () => sleep(30);
  const actorId = () => c.state.turn.activeUnitId!;
  const enemies = () => Object.values(c.state.units).filter((u) => u.team !== c.team && u.alive);
  const tryAttack = async (): Promise<boolean> => {
    for (const e of enemies()) {
      lastSeen.set(c.team, e.pos);
      const options = listActionsOnTarget(c.state, catalog, actorId(), e.id).filter((x) => x.available && x.command && (x.kind === 'attack' || x.kind === 'ability'));
      // Prefere habilidades (mais dano), depois o ataque básico.
      options.sort((x, y) => Number(y.kind === 'ability') - Number(x.kind === 'ability'));
      const pick = options[0];
      if (!pick) continue;
      await pace();
      const r = await c.execute({ ...(pick.command as GameplayCommand), expectedTurnId: c.state.turn.turnId });
      if (!r.ok) console.log(`  [${c.team}] ${pick.name} recusado: ${r.error.code}`);
      commands++;
      if (r.ok) return true;
    }
    return false;
  };
  for (let guard = 0; guard < 6 && c.state.status === 'active' && c.canControl(c.state.turn.activeUnitId); guard++) {
    if (await tryAttack()) continue;
    const me = c.state.units[actorId()]!;
    if (me.mp <= 0) break;
    let goal = enemies()[0]?.pos ?? lastSeen.get(c.team) ?? enemyStart[c.team]!;
    if (!enemies().length && lastSeen.has(c.team) && distance(me.pos, goal) <= 1) {
      lastSeen.delete(c.team); // chegou onde o viu e ele sumiu: volta ao canto inicial dele
      goal = enemyStart[c.team]!;
    }
    // Sem caminho até o objetivo (muro central, portas fechadas): vai até uma porta e abre.
    if (costTo(c.state, me.pos, goal) === Infinity) {
      const door = Object.values(c.state.objects)
        .filter((o) => o.defId === 'door' && o.state === 'closed')
        .sort((x, y) => distance(x.pos, me.pos) - distance(y.pos, me.pos))[0];
      if (door) {
        const open = listActionsOnTarget(c.state, catalog, me.id, door.id).find((x) => x.kind === 'interact' && x.available && x.command);
        if (open) {
          await pace();
          const r = await c.execute({ ...(open.command as GameplayCommand), expectedTurnId: c.state.turn.turnId });
          commands++;
          if (r.ok) {
            console.log(`  [${c.team}] abriu ${door.id}`);
            continue;
          }
        }
        goal = door.pos;
      }
    }
    const cells = [...reachableCells(c.state, catalog, me.pos, me.mp).values()].filter((r) => r.cost > 0);
    if (!cells.length) break;
    const here = costTo(c.state, me.pos, goal);
    if (process.env.E2E_VERBOSE) console.log(`  [${c.team}] r${c.state.turn.round} em ${me.pos.x},${me.pos.y},${me.pos.floor} PM ${me.mp} → objetivo ${goal.x},${goal.y} (custo ${here})`);
    const scored = cells.map((r) => ({ r, d: costTo(c.state, r.coord, goal) })).sort((x, y) => x.d - y.d || x.r.cost - y.r.cost);
    const best = scored[0]!;
    if (!(best.d < here)) break;
    const to = best.r.coord;
    await pace();
    const r = await c.execute({ type: 'MOVE', actorId: me.id, to, expectedTurnId: c.state.turn.turnId });
    commands++;
    if (!r.ok) {
      console.log(`  [${c.team}] MOVE recusado: ${r.error.code} ${r.error.message}`);
      break;
    }
  }
  if (c.state.status === 'active' && c.canControl(c.state.turn.activeUnitId)) {
    await pace();
    const r = await c.execute({ type: 'END_TURN', actorId: actorId(), expectedTurnId: c.state.turn.turnId });
    if (!r.ok) console.log(`  [${c.team}] END_TURN recusado: ${r.error.code} ${r.error.message}`);
    commands++;
  }
  return commands;
}

// ---------------------------------------------------------------------------
// Tentativas de trapaça (no primeiro turno)
// ---------------------------------------------------------------------------
async function cheats() {
  console.log('\ntentativas de trapaça:');
  await synced();
  const act = activeClient()!;
  const idle = act === a ? b : a;
  const myUnit = act.state.turn.activeUnitId!;
  const idleUnit = Object.values(idle.state.units).find((u) => u.team === idle.team)!.id;
  const code = (r: Awaited<ReturnType<NetworkMatch['execute']>>) => (r.ok ? 'ok' : r.error.code);
  const v0 = await serverVersion();
  check(code(await idle.execute({ type: 'END_TURN', actorId: idleUnit })) === 'WRONG_TURN', 'fora do turno → WRONG_TURN');
  check(code(await idle.execute({ type: 'END_TURN', actorId: myUnit })) === 'NOT_YOUR_UNIT', 'personagem da outra equipe → NOT_YOUR_UNIT');
  check(
    code(await act.sendRaw({ protocolVersion: PROTOCOL_VERSION, commandId: 'forjado-1', type: 'BASIC_ATTACK', actorId: myUnit, weaponId: 'weapon.iron_sword', target: { kind: 'self' }, damage: 999, result: 'victory' })) === 'INVALID_FORMAT',
    'campo "damage"/"result" forjado → INVALID_FORMAT',
  );
  check(code(await act.sendRaw({ protocolVersion: PROTOCOL_VERSION, commandId: 'debug-1', type: 'DEBUG_SET_UNIT', unitId: idleUnit, patch: { hp: 0 } })) === 'COMMAND_NOT_ALLOWED', 'DEBUG_SET_UNIT → COMMAND_NOT_ALLOWED');
  check(code(await act.sendRaw({ protocolVersion: PROTOCOL_VERSION, commandId: 'start-1', type: 'START_MATCH' })) === 'COMMAND_NOT_ALLOWED', 'START_MATCH do cliente → COMMAND_NOT_ALLOWED');
  const hiddenEnemy = act.state.turn.order.find((id) => !act.state.units[id]);
  if (hiddenEnemy) {
    const weapon = act.state.units[myUnit]!.weapons[0]!;
    const r = await act.sendRaw({ protocolVersion: PROTOCOL_VERSION, commandId: 'oculto-1', type: 'BASIC_ATTACK', actorId: myUnit, weaponId: weapon, target: { kind: 'entity', id: hiddenEnemy } });
    check(!r.ok, `atacar o inimigo oculto pelo id (${hiddenEnemy}) → recusado (${code(r)})`);
  }
  check((await serverVersion()) === v0, 'nada disso mudou o estado oficial');
  // commandId repetido.
  const env = { protocolVersion: PROTOCOL_VERSION, commandId: 'repetido-1', type: 'DEFEND', actorId: myUnit };
  const first = await act.sendRaw(env);
  const v1 = await serverVersion();
  const again = await act.sendRaw(env);
  check(first.ok && again.ok && v1 === v0 + 1 && (await serverVersion()) === v1, 'commandId repetido → mesma resposta, não reaplicado');
}

// ---------------------------------------------------------------------------
// Partida
// ---------------------------------------------------------------------------
await cheats();
console.log('\npartida:');
let total = 0;
let turns = 0;
let reconnected = false;
while (a.state.status === 'active' && total < MAX_COMMANDS) {
  await synced();
  const c = activeClient();
  if (!c) {
    await sleep(30);
    continue;
  }
  total += await playTurn(c);
  turns++;
  // Queda e reconexão do B no meio da partida.
  if (!reconnected && turns === 6) {
    reconnected = true;
    await synced();
    console.log('  [queda do B]');
    const token = b.roomRef.reconnectionToken;
    b.roomRef.reconnection.enabled = false;
    void b.roomRef.leave(false);
    await sleep(300);
    // A joga enquanto B está fora (se for a vez dele).
    const s = a.state;
    if (a.canControl(s.turn.activeUnitId)) total += await playTurn(a);
    const room = await new Client(URL_).reconnect(token);
    recordUpdates('B', room);
    room.onLeave((code, reason) => console.log('  [B2 saiu]', code, reason));
    room.onDrop((code, reason) => console.log('  [B2 caiu]', code, reason));
    room.onError((code, reason) => console.log('  [B2 erro]', code, reason));
    const snapshot = await waitSnapshot(room);
    b = new NetworkMatch(catalog, room, snapshot);
    watchSync(b);
    const dbg = await getJson<{ seats: Array<{ team: string; projection: { hash: string } }> }>(`/debug/matches/${matchId}`);
    check(snapshot.reason === 'reconnect' && stateHash(b.state) === dbg.seats.find((x) => x.team === 'B')!.projection.hash, 'reconexão do B: snapshot = projeção oficial atual');
  }
}
await synced().catch(() => undefined);
await sleep(300);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Conferência final
// ---------------------------------------------------------------------------
console.log('\nconferência:');
const dbg = await getJson<{
  live: boolean;
  version: number;
  official: GameState;
  officialHash: string;
  seats: Array<{ team: string; projection: { hash: string }; inSync: boolean; divergences: unknown[] }>;
}>(`/debug/matches/${matchId}`);
const official = dbg.official;
check(official.status === 'finished', `partida terminou (${JSON.stringify(official.result)})`);
check(official.result?.kind === 'victory', 'com vitória');
check(stableStringify(a.state.result) === stableStringify(official.result) && stableStringify(b.state.result) === stableStringify(official.result), 'resultado dos clientes = resultado oficial');
for (const [team, c] of [['A', a], ['B', b]] as const) {
  const seat = dbg.seats.find((x) => x.team === team)!;
  check(stateHash(c.state) === seat.projection.hash, `${team}: hash final do cliente = projeção oficial final (${seat.projection.hash})`);
  check(seat.divergences.length === 0, `${team}: nenhum ack divergente registrado no servidor`);
}
check(outOfSync === 0, 'nenhuma versão com hash local ≠ hash do servidor');

// Toda versão: o que cada equipe recebeu = projeção do estado oficial persistido.
let leakFree = true;
let eventsMatch = true;
let hiddenVersions = 0;
let prev: GameState | null = null;
for (let v = 0; v <= dbg.version; v++) {
  const off = await getJson<{ state: GameState; events: GameEvent[] }>(`/debug/matches/${matchId}/versions/${v}`);
  if (prev) {
    for (const team of ['A', 'B'] as const) {
      const got = received[team].get(v);
      if (!got) continue; // B fora do ar nesta versão (veio no snapshot da reconexão)
      const exp = projectStateForClient(off.state, catalog, team).state;
      if (stateHash(exp) !== got.hash || stateHash(got.state) !== got.hash) leakFree = false;
      const expEvents = projectEventsForTeam(off.events, prev, off.state, catalog, team);
      // Fase 6: cada equipe recebe os eventos numerados em sequência própria (o seq oficial revelaria
      // quantos eventos ocultos houve) — compara sem o seq.
      const noSeq = (evs: GameEvent[]) => evs.map(({ seq: _s, ...e }) => e);
      if (stableStringify(noSeq(expEvents)) !== stableStringify(noSeq(got.events))) eventsMatch = false;
      const hidden = Object.values(off.state.units).filter((u) => u.alive && u.team !== team && !got.state.units[u.id]);
      // Inimigo vivo no estado recebido precisa estar na visão da equipe (exceto com a partida encerrada).
      if (off.state.status !== 'finished') {
        const vision = computeTeamVision(off.state, catalog, team);
        for (const u of Object.values(got.state.units)) if (u.alive && u.team !== team && !vision.visibleUnits.has(u.id)) leakFree = false;
      }
      if (hidden.length) hiddenVersions++;
      // Nenhum id de personagem oculto aparece como entidade no estado recebido.
      for (const u of hidden) if (JSON.stringify(got.state.units).includes(`"id":"${u.id}"`)) leakFree = false;
    }
  }
  prev = off.state;
}
check(leakFree, 'todas as versões: estado recebido = projeção do oficial persistido (sem vazamento)');
check(eventsMatch, 'todas as versões: eventos recebidos = eventos oficiais filtrados para a equipe');
check(hiddenVersions > 0, `informação oculta exercitada (${hiddenVersions} envios com o inimigo fora da visão)`);
const officialEvents = await getJson<{ events: GameEvent[] }>(`/debug/matches/${matchId}/versions/${dbg.version}`);
check(officialEvents.events.some((e) => e.type === 'MATCH_ENDED'), 'MATCH_ENDED gerado pelo servidor na última versão');
const verify = await getJson<{ ok: boolean; commands: number; versions: number; finalHash: string; errors: string[] }>(`/debug/matches/${matchId}/verify`);
check(verify.ok && verify.finalHash === dbg.officialHash, `replay do registro persistido reproduz o hash final (${verify.commands} comandos, ${verify.versions} versões)`);

const summary = {
  seed: SEED,
  matchId,
  result: official.result,
  rounds: official.turn.round,
  turns,
  clientCommands: total,
  versions: dbg.version,
  hiddenVersions,
  seconds: Number(elapsed),
  finalHashes: { official: dbg.officialHash, A: stateHash(a.state), B: stateHash(b.state) },
  failures,
};
writeFileSync(`${OUT}/resultado.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(`\n${JSON.stringify(summary, null, 2)}`);
await JA.room.leave().catch(() => undefined);
await b.roomRef.leave().catch(() => undefined);
stopServer();
if (failures.length) {
  console.error('\nlog do servidor (fim):\n' + serverLog.join('').split('\n').slice(-30).join('\n'));
  console.error(`\nFALHOU: ${failures.length} conferência(s)`);
  process.exit(1);
}
console.log('\nE2E rede: OK');
process.exit(0);
