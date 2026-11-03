import { describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import type { GameEvent } from '@bardurinho/domain';
import { SOUNDS, soundsForEvent } from '../../apps/web/src/rendering/sfx.js';

const ev = (type: GameEvent['type'], payload: Record<string, unknown>, definitionId: string | null = null): GameEvent => ({
  seq: 1, type, round: 1, turnId: 1, cause: { commandSeq: 1, sourceId: null, definitionId }, payload,
});

describe('efeitos sonoros (Fase 4): evento aceito → som', () => {
  it('toda habilidade, arma e consumível tem um som de uso próprio e existente', () => {
    const cast = new Set<string>();
    for (const ab of Object.values(catalog.abilities)) {
      const s = soundsForEvent(ev('ABILITY_USED', { abilityId: ab.id }));
      expect(s.length, ab.id).toBe(1);
      expect(SOUNDS[s[0]!], `${ab.id} → ${s[0]}`).toBeDefined();
      cast.add(s[0]!);
    }
    for (const it of Object.values(catalog.items)) {
      if (it.kind === 'weapon') expect(SOUNDS[soundsForEvent(ev('ATTACK_PERFORMED', { weaponId: it.id }))[0]!], it.id).toBeDefined();
      if (it.kind === 'consumable') expect(SOUNDS[soundsForEvent(ev('ITEM_USED', { itemId: it.id }))[0]!], it.id).toBeDefined();
    }
    // As dez habilidades não soam todas iguais.
    expect(cast.size).toBeGreaterThanOrEqual(8);
  });

  it('dano por tipo, bloqueio, erro, crítico, explosão, cura, foco, barreira, estados, superfícies, água e objetos', () => {
    for (const t of ['physical', 'fire', 'cold', 'arcane', 'nature']) expect(soundsForEvent(ev('DAMAGE_APPLIED', { hpDamage: 5, damageType: t }))).toEqual([`impact.${t}`]);
    expect(soundsForEvent(ev('DAMAGE_APPLIED', { hpDamage: 0, damageType: 'fire' }))).toEqual(['impact.blocked']);
    expect(soundsForEvent(ev('ATTACK_ROLLED', { hit: false }))).toEqual(['miss']);
    expect(soundsForEvent(ev('ATTACK_ROLLED', { hit: true, critical: true }))).toEqual(['crit']);
    expect(soundsForEvent(ev('EXPLOSION', {}))).toEqual(['explosion']);
    expect(soundsForEvent(ev('HEALED', { effective: 10 }))).toEqual(['heal']);
    expect(soundsForEvent(ev('RESOURCE_RESTORED', { before: 2, after: 6 }))).toEqual(['focus.restore']);
    expect(soundsForEvent(ev('SHIELD_GRANTED', { applied: true }))).toEqual(['shield.up']);
    for (const st of Object.keys(catalog.statuses)) {
      for (const s of soundsForEvent(ev('STATUS_APPLIED', { statusId: st }))) expect(SOUNDS[s]).toBeDefined();
      for (const s of soundsForEvent(ev('STATUS_EXPIRED', { statusId: st }))) expect(SOUNDS[s]).toBeDefined();
    }
    expect(soundsForEvent(ev('SURFACE_CREATED', { surface: 'fire' }))).toEqual(['ignite']);
    expect(soundsForEvent(ev('SURFACE_CREATED', { surface: 'oil' }))).toEqual(['oil']);
    expect(soundsForEvent(ev('SURFACE_CREATED', { surface: 'thorns' }))).toEqual(['thorns']);
    expect(soundsForEvent(ev('STIMULUS_EMITTED', { stimulus: 'water' }))).toEqual(['water']);
    expect(soundsForEvent(ev('OBJECT_STATE_CHANGED', { objectId: 'door-01' }))).toEqual(['door']);
    expect(soundsForEvent(ev('OBJECT_STATE_CHANGED', { objectId: 'lever-01' }))).toEqual(['lever']);
    expect(soundsForEvent(ev('CONSUMABLE_GRANTED', { itemId: 'consumable.health_potion' }))).toEqual(['chest']);
    expect(soundsForEvent(ev('OBJECT_DESTROYED', { defId: 'crate' }))).toEqual(['wood.break']);
    expect(soundsForEvent(ev('UNIT_DEFEATED', {}))).toEqual(['defeat']);
  });

  it('receitas válidas: duração e ganho positivos, frequências audíveis', () => {
    for (const [id, layers] of Object.entries(SOUNDS)) {
      expect(layers.length, id).toBeGreaterThan(0);
      for (const l of layers) {
        expect(l.dur, id).toBeGreaterThan(0);
        expect(l.gain, id).toBeGreaterThan(0);
        expect(l.gain, id).toBeLessThanOrEqual(0.7);
        expect(l.f0, id).toBeGreaterThanOrEqual(20);
      }
    }
  });
});
