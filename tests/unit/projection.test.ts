import { describe, expect, it } from 'vitest';
import { patioDasRuinas } from '@bardurinho/content';
import { buildScenario, projectEventsForTeam, projectStateForClient, type GameEvent, type GameState } from '@bardurinho/domain';
import { parseClientCommand, stableStringify, stateHash } from '@bardurinho/protocol';
import { catalog, run } from './helpers.js';

/** Pátio das Ruínas com dados fixos; Guerreiro A em (7,0), Mago B em (8,15): fora de visão. */
const patio = (): GameState => buildScenario(catalog, { ...patioDasRuinas.scenario, dice: 'average', initiative: 'fixed', order: ['mage-01', 'warrior-01'] });

const ev = (seq: number, type: GameEvent['type'], payload: Record<string, unknown>, sourceId: string | null = null): GameEvent => ({
  seq,
  type,
  round: 1,
  turnId: 1,
  cause: { commandSeq: 1, sourceId, definitionId: null },
  payload,
});

describe('visão individual para a rede (projectStateForClient / projectEventsForTeam)', () => {
  it('estado: remove o inimigo não detectado e a semente dos dados', () => {
    const s = patio();
    const a = projectStateForClient(s, catalog, 'A').state;
    expect(Object.keys(a.units)).toEqual(['warrior-01']);
    expect(a.rng.seed).toBe(0);
    expect(JSON.stringify(a)).not.toContain('"id":"mage-01"');
    // ... a ordem da iniciativa continua pública (só identificadores).
    expect(a.turn.order).toContain('mage-01');
    const b = projectStateForClient(s, catalog, 'B').state;
    expect(Object.keys(b.units)).toEqual(['mage-01']);
    // O original não é modificado.
    expect(s.rng.seed).not.toBe(0);
    expect(Object.keys(s.units)).toHaveLength(2);
  });

  it('eventos: movimento e gasto de um inimigo oculto não chegam à outra equipe', () => {
    const s = patio();
    const r = run(s, { type: 'MOVE', actorId: 'mage-01', to: { x: 8, y: 13, floor: 0 } });
    expect(r.events.some((e) => e.type === 'UNIT_MOVED')).toBe(true);
    const forA = projectEventsForTeam(r.events, s, r.state, catalog, 'A');
    const leaked = forA.filter((e) => JSON.stringify(e.payload).includes('mage-01') || e.cause.sourceId === 'mage-01');
    expect(leaked).toEqual([]);
    // A própria equipe recebe tudo.
    const forB = projectEventsForTeam(r.events, s, r.state, catalog, 'B');
    expect(forB.map((e) => e.type)).toEqual(r.events.map((e) => e.type));
  });

  it('eventos: estrutura do turno é pública; o COMMAND_ACCEPTED adversário vai resumido ou some', () => {
    const s = patio();
    const r = run(s, { type: 'END_TURN', actorId: 'mage-01' });
    const forA = projectEventsForTeam(r.events, s, r.state, catalog, 'A');
    expect(forA.map((e) => e.type)).toContain('TURN_ENDED');
    expect(forA.map((e) => e.type)).toContain('TURN_STARTED');
    expect(forA.find((e) => e.type === 'COMMAND_ACCEPTED')).toBeUndefined();
  });

  it('eventos: referência mista mantém o evento com o desconhecido trocado por null', () => {
    const s = patio();
    const events = [
      ev(1, 'ATTACK_ROLLED', { attackerId: 'mage-01', targetId: 'warrior-01', hit: true }, 'mage-01'),
      ev(2, 'DAMAGE_APPLIED', { targetId: 'warrior-01', hpDamage: 5 }, 'mage-01'),
      ev(3, 'ABILITY_USED', { actorId: 'mage-01', abilityId: 'mage.flame', target: { x: 7, y: 0, floor: 0 } }, 'mage-01'),
      ev(4, 'SURFACE_CREATED', { cell: { x: 7, y: 1, floor: 0 }, surface: 'fire' }, 'mage-01'),
    ];
    const forA = projectEventsForTeam(events, s, s, catalog, 'A');
    expect(forA.map((e) => e.type)).toEqual(['ATTACK_ROLLED', 'DAMAGE_APPLIED', 'SURFACE_CREATED']);
    expect(forA[0]!.payload.attackerId).toBeNull();
    expect(forA.every((e) => e.cause.sourceId === null)).toBe(true);
  });

  it('eventos: passo de inimigo visível só aparece se o destino é visível', () => {
    const s = patio();
    // Inimigo visível (perto do guerreiro), mas um passo termina numa célula fora da visão.
    const near = structuredClone(s);
    near.units['mage-01']!.pos = { x: 7, y: 4, floor: 0 };
    const events = [
      ev(1, 'UNIT_MOVED', { unitId: 'mage-01', from: { x: 7, y: 4, floor: 0 }, to: { x: 7, y: 5, floor: 0 } }),
      ev(2, 'UNIT_MOVED', { unitId: 'mage-01', from: { x: 7, y: 5, floor: 0 }, to: { x: 5, y: 8, floor: 0 } }),
    ];
    const forA = projectEventsForTeam(events, near, near, catalog, 'A');
    expect(forA.map((e) => (e.payload.to as { y: number }).y)).toEqual([5]);
  });
});

describe('protocolo (formato, envelope e hash)', () => {
  const base = { protocolVersion: 1, commandId: 'c-1' };
  it('aceita comandos do jogador bem formados', () => {
    expect(parseClientCommand({ ...base, type: 'END_TURN', actorId: 'warrior-01' }).ok).toBe(true);
    expect(parseClientCommand({ ...base, type: 'MOVE', actorId: 'warrior-01', to: { x: 1, y: 2, floor: 0 }, expectedTurnId: 3 }).ok).toBe(true);
    expect(parseClientCommand({ ...base, type: 'USE_ABILITY', actorId: 'mage-01', abilityId: 'mage.flame', target: { kind: 'cell', x: 1, y: 1, floor: 0 } }).ok).toBe(true);
  });
  it('recusa formato inválido, campos extras (dano), debug e START_MATCH', () => {
    const code = (v: unknown) => {
      const r = parseClientCommand(v);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ type: 'END_TURN', actorId: 'x' })).toBe('INVALID_FORMAT');
    expect(code({ ...base, protocolVersion: 2, type: 'END_TURN', actorId: 'x' })).toBe('UNSUPPORTED_PROTOCOL');
    expect(code({ ...base, type: 'BASIC_ATTACK', actorId: 'x', weaponId: 'w', target: { kind: 'self' }, damage: 999 })).toBe('INVALID_FORMAT');
    expect(code({ ...base, type: 'MOVE', actorId: 'x', to: { x: -1, y: 0, floor: 0 } })).toBe('INVALID_FORMAT');
    expect(code({ ...base, type: 'DEBUG_SET_UNIT', unitId: 'x', patch: { hp: 999 } })).toBe('COMMAND_NOT_ALLOWED');
    expect(code({ ...base, type: 'START_MATCH' })).toBe('COMMAND_NOT_ALLOWED');
    expect(code({ ...base, type: 'NOPE', actorId: 'x' })).toBe('INVALID_FORMAT');
  });
  it('hash estável independe da ordem das chaves', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
    const s = patio();
    expect(stateHash(JSON.parse(JSON.stringify(s)))).toBe(stateHash(s));
  });
});
