/**
 * Fase 6 — exploits e ocultação de informação no servidor (sem rede: `MatchSession` + PGlite em
 * memória, ver `support/matchHarness.ts`).
 *
 * - Ocultação: partidas bot × bot completas; cada mensagem enviada a cada equipe passa pelo
 *   auditor (nenhum id/classe de inimigo não visto, semente e contador de eventos zerados, tipo
 *   do comando oculto, ids opacos).
 * - Fuzz baseado em propriedades: entre jogadas legítimas, milhares de mensagens hostis geradas
 *   (formato errado, campos extras, debug, START_MATCH, ids forjados, fora da vez, repetição de
 *   commandId, tamanhos absurdos, protótipo). Propriedades: o servidor nunca lança exceção;
 *   recusa ⇒ estado oficial e versão intactos; aceito ⇒ igual ao core; o replay do registro
 *   reproduz a partida; nenhuma resposta vaza a resposta de outro assento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BotBrain, exploreTargets } from '@bardurinho/ai';
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { applyCommand, type GameplayCommand } from '@bardurinho/domain';
import { PROTOCOL_VERSION, stateHash } from '@bardurinho/protocol';
import { verifyMatchReplay } from '../../apps/server/src/modules/matches/replay.js';
import { openHarness, startSession, type Harness } from './support/matchHarness.js';

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
}, 60_000);
afterAll(async () => {
  await h?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gerador determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Fase 6 — ocultação de informação (auditoria de todas as mensagens)', () => {
  it('partidas bot × bot completas: nenhuma mensagem revela inimigo não visto, classe, semente ou contadores', async () => {
    const pairs: Array<[string, string]> = [
      ['rogue', 'mage'],
      ['druid', 'warrior'],
    ];
    for (const [i, classes] of pairs.entries()) {
      const run = await startSession(h, { seed: 500 + i, classes, bots: ['normal', 'easy'] });
      const t0 = Date.now();
      while (run.session.state.status !== 'finished' && Date.now() - t0 < 30_000) await sleep(20);
      await run.session.idle();
      expect(run.session.state.status, `partida ${classes.join('×')} terminou`).toBe('finished');
      expect(run.problems, classes.join('×')).toEqual([]);
      // Houve de fato informação oculta a proteger (o inimigo começou fora da visão).
      const first = run.sent.find((s) => s.type === 'update')!.msg as { state: { units: Record<string, unknown> } };
      expect(Object.keys(first.state.units)).toHaveLength(1);
      expect((await verifyMatchReplay(h.matches, catalog, run.session.id)).ok).toBe(true);
      for (const b of run.bots) b.dispose();
      run.session.dispose();
    }
  }, 120_000);
});

describe('Fase 6 — o auditor de ocultação detecta vazamentos', () => {
  it('estado oficial sem projeção, id do inimigo num evento e semente dos dados são apontados', async () => {
    const run = await startSession(h, { seed: 3, classes: ['warrior', 'mage'] });
    const s = run.session;
    const team = s.seats[0]!.team;
    const enemy = Object.values(s.state.units).find((u) => u.team !== team)!;
    const { auditMessage } = await import('./support/matchHarness.js');
    expect(auditMessage(team, 'update', { state: s.state, events: [] }, s.state, s.state).join()).toMatch(/inimigo oculto|semente/);
    const ok = s.projection(team).state;
    expect(auditMessage(team, 'update', { state: ok, events: [] }, s.state, s.state)).toEqual([]);
    expect(auditMessage(team, 'update', { state: ok, events: [{ type: 'DAMAGE_APPLIED', payload: { attackerId: enemy.id } }] }, s.state, s.state).join()).toMatch(/id do inimigo/);
    expect(run.problems).toEqual([]);
    s.dispose();
  });
});

describe('Fase 6 — detecção de divergência (desync)', () => {
  it('ack com hash diferente do enviado vira divergência registrada; o correto não', async () => {
    const run = await startSession(h, { seed: 8, classes: ['rogue', 'warrior'] });
    const s = run.session;
    const sent = s.seats[0]!.sent!;
    expect(s.ack(0, sent.version, sent.hash)).toBe(true);
    expect(s.ack(0, sent.version, 'f'.repeat(14))).toBe(false);
    expect(s.seats[0]!.divergences).toEqual([{ version: sent.version, expected: sent.hash, got: 'f'.repeat(14) }]);
    expect(s.ack(0, 9999, 'x')).toBeNull(); // versão que não foi enviada: ignorada
    expect(s.ack(0, 'x', 1)).toBeNull(); // formato errado: ignorado
    s.dispose();
  });
});

describe('Fase 6 — fuzz de comandos hostis', () => {
  // `FUZZ_MATCHES=20 npm run fuzz:server` roda o lote maior (padrão: 2 partidas no `npm test`).
  const FUZZ_MATCHES = Number(process.env.FUZZ_MATCHES ?? 2);
  const CLASSES = ['warrior', 'rogue', 'mage', 'druid'];
  it.each(Array.from({ length: FUZZ_MATCHES }, (_, i) => i))('partida %i: mensagens hostis entre jogadas legítimas — sem exceção, sem efeito, replay íntegro', async (k) => {
    const run = await startSession(h, { seed: 77 + k, classes: [CLASSES[k % 4]!, CLASSES[(k + 1 + Math.floor(k / 4)) % 4]!] });
    const s = run.session;
    const r = rng(1234 + k);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const brains = s.seats.map((seat) => new BotBrain(catalog, seat.team, { difficulty: 'normal', seed: 5 + seat.seat, explore: exploreTargets(patioDasRuinas, seat.team) }));
    const unitIds = () => Object.keys(s.state.units);
    const acceptedIds: Array<{ seat: number; id: string }> = [];
    let n = 0;
    const id = () => `fz-${n++}`;
    const coords = [{ x: 3, y: 3, floor: 0 }, { x: -1, y: 0, floor: 0 }, { x: 1e9, y: 2, floor: 0 }, { x: 1.5, y: 2, floor: 0 }, { x: 2, y: 2, floor: 0, extra: 1 }, { x: '2', y: 2, floor: 0 }, null, 'b2', [1, 2]];
    const weird = [null, undefined, 0, -1, 1e308, '', 'x'.repeat(5000), {}, [], true, { __proto__: { admin: true } }, JSON.parse('{"__proto__":{"polluted":1}}')];
    const types = ['MOVE', 'BASIC_ATTACK', 'USE_ABILITY', 'USE_ITEM', 'DEFEND', 'INTERACT', 'END_TURN', 'SURRENDER', 'START_MATCH', 'DEBUG_SET_HP', 'DEBUG_SPAWN', 'move', 'NOPE', '__proto__'];
    const hostile = (seat: number): unknown => {
      const own = Object.values(s.state.units).find((u) => u.team === s.seats[seat]!.team)!;
      const enemy = Object.values(s.state.units).find((u) => u.team !== s.seats[seat]!.team)!;
      const base: Record<string, unknown> = { protocolVersion: PROTOCOL_VERSION, commandId: id(), type: pick(types), actorId: pick([enemy.id, own.id, 'unit-z9', 'warrior-01', '', 'a'.repeat(65), '../../etc', ...unitIds()]) };
      switch (Math.floor(r() * 12)) {
        case 0: return pick(weird);
        case 1: return { ...base, commandId: pick([undefined, '', 'c'.repeat(65), 42, null]) };
        case 2: return { ...base, protocolVersion: pick([0, 2, '1', null]) };
        case 3: return { ...base, type: 'MOVE', to: pick(coords) };
        case 4: return { ...base, type: 'BASIC_ATTACK', actorId: own.id, weaponId: pick([...enemy.weapons, 'weapon.nope', ...own.weapons]), target: pick([{ kind: 'entity', id: enemy.id }, { kind: 'cell', ...pick(coords) as object }, { kind: 'self' }, { kind: 'entity' }, { kind: 'bogus' }]), damage: pick([undefined, 999]) };
        case 5: return { ...base, type: 'USE_ABILITY', actorId: own.id, abilityId: pick(['mage.flame', 'druid.natural_heal', 'rogue.hide', 'warrior.charge', 'nope', ...own.abilities]), target: { kind: 'entity', id: enemy.id } };
        case 6: return { ...base, type: 'USE_ITEM', actorId: own.id, itemId: pick(['consumable.health_potion', 'consumable.oil_flask', 'consumable.nope', 'weapon.dagger']) };
        case 7: return { ...base, type: 'END_TURN', actorId: own.id, expectedTurnId: pick([-1, 0, s.state.turn.turnId - 1, 1_000_001, '1']) };
        case 8: return { ...base, type: 'DEFEND', actorId: own.id, hp: 999, ignoreCost: true, options: { allowDebugCommands: true } };
        case 9: { // repetição de commandId aceito (meu ou do outro)
          const prev = acceptedIds.length ? pick(acceptedIds) : null;
          return prev ? { ...base, type: 'END_TURN', actorId: own.id, commandId: prev.id } : base;
        }
        case 10: { // aninhamento profundo
          let deep: Record<string, unknown> = { kind: 'self' };
          for (let i = 0; i < 200; i++) deep = { kind: 'cell', x: deep };
          return { ...base, type: 'USE_ABILITY', actorId: own.id, abilityId: own.abilities[0], target: deep };
        }
        default: return { ...base, type: pick(['INTERACT', 'DEBUG_SET_HP', 'START_MATCH']), objectId: pick(['door-01', 'barrel-01', 'nope', 7]), hp: 0 };
      }
    };

    let hostileSent = 0;
    let hostileAccepted = 0;
    let legit = 0;
    for (let step = 0; step < 4000 && s.state.status === 'active'; step++) {
      const activeTeam = s.state.units[s.state.turn.activeUnitId!]!.team;
      const activeSeat = s.seats.find((x) => x.team === activeTeam)!.seat;
      if (r() < 0.9) {
        const seat = r() < 0.5 ? activeSeat : 1 - activeSeat;
        const msg = hostile(seat);
        const before = s.state;
        const v = s.version;
        const res = await s.submit(seat, msg);
        hostileSent++;
        if (!res.ok) {
          expect(s.version).toBe(v);
          expect(stateHash(s.state)).toBe(stateHash(before));
          // Repetição de commandId alheio: não revela a resposta do outro assento.
          if (res.duplicate) {
            const owner = acceptedIds.find((a) => a.id === res.commandId);
            if (owner && owner.seat !== seat) expect(res.error.code).toBe('DUPLICATE_COMMAND');
          }
        } else if (res.duplicate) {
          expect(s.version).toBe(v); // a repetição devolve a resposta antiga, sem reaplicar
        } else {
          // Aceito: tem de ser exatamente o que o core faria (nada além do formato permitido).
          hostileAccepted++;
          const { protocolVersion: _p, commandId: _c, ...cmd } = msg as Record<string, unknown>;
          const expected = applyCommand(before, catalog, cmd as unknown as GameplayCommand, {});
          expect(expected.ok).toBe(true);
          expect(stateHash(s.state)).toBe(stateHash(expected.state));
          acceptedIds.push({ seat, id: res.commandId });
        }
      } else {
        const view = s.projection(activeTeam).state;
        const d = brains[activeSeat]!.decide(view);
        const cid = id();
        const res = await s.submit(activeSeat, { ...d.command, protocolVersion: PROTOCOL_VERSION, commandId: cid });
        legit++;
        if (res.ok) acceptedIds.push({ seat: activeSeat, id: cid });
        else brains[activeSeat]!.rejectedCommand(d.command);
        if (!res.ok && d.command.type === 'END_TURN') break;
      }
    }
    await s.idle();
    expect(hostileSent).toBeGreaterThan(300);
    expect(legit).toBeGreaterThan(20);
    expect(run.problems).toEqual([]);
    const report = await verifyMatchReplay(h.matches, catalog, s.id);
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    // Recusados ficam registrados para auditoria, com o conteúdo limitado (≤ 4 KB).
    const rejected = (await h.matches.commands(s.id)).filter((c) => !c.accepted);
    expect(rejected.length).toBeGreaterThan(100);
    for (const c of rejected) expect(JSON.stringify(c.payload ?? null).length).toBeLessThanOrEqual(4096);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    console.log(`fuzz: ${hostileSent} hostis (${hostileAccepted} aceitos por serem válidos), ${legit} legítimos, partida ${s.state.status} na v${s.version}`);
    s.dispose();
  }, 120_000);

  it('comandos do autor errado: personagem do adversário, fora da vez, assento sem jogador', async () => {
    const run = await startSession(h, { seed: 91, classes: ['mage', 'druid'] });
    const s = run.session;
    const active = s.state.units[s.state.turn.activeUnitId!]!;
    const activeSeat = s.seats.find((x) => x.team === active.team)!.seat;
    const other = 1 - activeSeat;
    // Alvo oculto ≡ alvo inexistente (sem oráculo de posição pelas mensagens de erro do core).
    const hiddenEnemy = Object.values(s.state.units).find((u) => u.team !== active.team)!;
    expect(s.projection(active.team).state.units[hiddenEnemy.id]).toBeUndefined();
    const weaponId = active.weapons[0]!;
    const atk = (cid: string, target: unknown) => s.submit(activeSeat, { type: 'BASIC_ATTACK', actorId: active.id, weaponId, target, protocolVersion: PROTOCOL_VERSION, commandId: cid });
    const rh = await atk('o1', { kind: 'entity', id: hiddenEnemy.id });
    const rn = await atk('o2', { kind: 'entity', id: 'unit-b7' });
    expect(!rh.ok && !rn.ok && rh.error.code === rn.error.code && rh.error.message.replace(hiddenEnemy.id, '?') === rn.error.message.replace('unit-b7', '?')).toBe(true);
    const enemyOfOther = Object.values(s.state.units).find((u) => u.team !== s.seats[other]!.team)!;
    const r1 = await s.submit(other, { type: 'END_TURN', actorId: enemyOfOther.id, protocolVersion: PROTOCOL_VERSION, commandId: 'x1' });
    expect(r1.ok || r1.error.code).toBe('NOT_YOUR_UNIT');
    const mine = Object.values(s.state.units).find((u) => u.team === s.seats[other]!.team)!;
    const r2 = await s.submit(other, { type: 'END_TURN', actorId: mine.id, protocolVersion: PROTOCOL_VERSION, commandId: 'x2' });
    expect(r2.ok || r2.error.code).toBe('WRONG_TURN');
    const r3 = await s.submit(7, { type: 'END_TURN', actorId: active.id, protocolVersion: PROTOCOL_VERSION, commandId: 'x3' });
    expect(r3.ok || r3.error.code).toBe('NOT_A_PLAYER');
    // Desistir vale fora da vez (Fase 6) e encerra a partida a favor do adversário.
    const r4 = await s.submit(other, { type: 'SURRENDER', actorId: mine.id, protocolVersion: PROTOCOL_VERSION, commandId: 'x4' });
    expect(r4.ok).toBe(true);
    expect(s.state.result).toMatchObject({ kind: 'victory', winnerTeam: active.team, reason: 'surrender' });
    s.dispose();
  });
});
