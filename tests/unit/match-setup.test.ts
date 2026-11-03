import { describe, expect, it } from 'vitest';
import {
  catalog,
  decodeSetup,
  DEFAULT_SETUP,
  encodeSetup,
  normalizeChoice,
  normalizeTeam,
  patioDasRuinas,
  scenarioFromSetup,
  type MatchSetup,
} from '@bardurinho/content';
import { applyCommand, buildScenario, hasLineOfSight, listUnitActions } from '@bardurinho/domain';

const all4: MatchSetup = {
  teams: {
    A: [
      { classId: 'warrior', accessoryId: 'accessory.vitality_amulet', consumables: ['consumable.health_potion', 'consumable.oil_flask'] },
      { classId: 'rogue', accessoryId: 'accessory.ash_medallion', consumables: ['consumable.focus_potion'] },
    ],
    B: [
      { classId: 'mage', accessoryId: 'accessory.frost_medallion', consumables: [] },
      { classId: 'druid', accessoryId: null, consumables: ['consumable.health_potion', 'consumable.focus_potion'] },
    ],
  },
};

describe('escolha de personagens (Fase 4)', () => {
  it('normaliza escolhas inválidas: classe desconhecida, acessório que não é acessório, consumíveis repetidos/demais', () => {
    expect(normalizeChoice(catalog, { classId: 'paladino', accessoryId: 'weapon.dagger', consumables: ['health_potion', 'consumable.health_potion', 'focus_potion', 'oil_flask'] }, 'mage')).toEqual({
      classId: 'mage',
      accessoryId: null,
      consumables: ['consumable.health_potion', 'consumable.focus_potion'],
    });
    expect(normalizeChoice(catalog, { classId: 'rogue', accessoryId: 'vitality_amulet' }, 'mage').accessoryId).toBe('accessory.vitality_amulet');
    // Tamanho forçado (formato da sala): completa com as classes padrão da equipe.
    expect(normalizeTeam(catalog, 'B', [], 2).map((c) => c.classId)).toEqual(['mage', 'druid']);
    expect(normalizeTeam(catalog, 'A', [{ classId: 'druid' }, { classId: 'mage' }, { classId: 'rogue' }]).map((c) => c.classId)).toEqual(['druid', 'mage']);
  });

  it('texto da URL (?setup=) ida e volta', () => {
    const text = encodeSetup(all4);
    expect(text).toBe('A=warrior:vitality_amulet:health_potion,oil_flask|rogue:ash_medallion:focus_potion;B=mage:frost_medallion|druid::health_potion,focus_potion');
    expect(decodeSetup(catalog, text)).toEqual(all4);
    expect(decodeSetup(catalog, 'lixo')).toBeNull();
  });

  it('2 × 2 com as quatro classes: pontos de início, acessórios, consumíveis e ids únicos', () => {
    const scenario = scenarioFromSetup(patioDasRuinas, catalog, all4);
    const state = buildScenario(catalog, { ...scenario, dice: 'random', seed: 3 });
    expect(state.status).toBe('active');
    const u = state.units;
    expect(Object.keys(u).sort()).toEqual(['druid-01', 'mage-01', 'rogue-01', 'warrior-01']);
    expect(u['warrior-01']).toMatchObject({ team: 'A', pos: { x: 7, y: 0, floor: 0 }, maxHp: 118, hp: 118, armor: 4, consumables: ['consumable.health_potion', 'consumable.oil_flask'] });
    expect(u['rogue-01']).toMatchObject({ team: 'A', pos: { x: 6, y: 0, floor: 0 }, resistances: { fire: 2 }, armor: 2, weapons: ['weapon.dagger', 'weapon.short_bow'] });
    expect(u['mage-01']).toMatchObject({ team: 'B', pos: { x: 8, y: 15, floor: 0 }, resistances: { cold: 2 }, armor: 0, maxHp: 80 });
    expect(u['druid-01']).toMatchObject({ team: 'B', pos: { x: 9, y: 15, floor: 0 }, maxHp: 95, consumables: ['consumable.health_potion', 'consumable.focus_potion'] });
    // As quatro classes jogáveis: cada uma tem a barra de ações com as próprias habilidades.
    for (const unit of Object.values(u)) {
      const keys = listUnitActions(state, catalog, unit.id, { ignoreTurn: true }).map((a) => a.key);
      for (const ab of unit.abilities) expect(keys).toContain(`ability:${ab}`);
      for (const it of unit.consumables) expect(keys).toContain(`item:${it}`);
    }
  });

  it('pontos de início das duas equipes sem linha de visão direta entre si (seção 6.1)', () => {
    for (const a of patioDasRuinas.spawns.A)
      for (const b of patioDasRuinas.spawns.B) {
        expect(hasLineOfSight(buildScenario(catalog, patioDasRuinas.scenario), catalog, { ...a, floor: 0 }, { ...b, floor: 0 })).toBe(false);
      }
  });

  it('duelo padrão mantém os ids do cenário do mapa (warrior-01 × mage-01) e começa com 2 consumíveis', () => {
    const s = buildScenario(catalog, scenarioFromSetup(patioDasRuinas, catalog, DEFAULT_SETUP));
    expect(Object.keys(s.units).sort()).toEqual(['mage-01', 'warrior-01']);
    expect(s.units['mage-01']!.consumables).toEqual(['consumable.health_potion', 'consumable.focus_potion']);
    // Classe repetida: ids continuam únicos.
    const mirror = buildScenario(catalog, scenarioFromSetup(patioDasRuinas, catalog, { teams: { A: [{ classId: 'rogue' }], B: [{ classId: 'rogue' }] } }));
    expect(Object.keys(mirror.units).sort()).toEqual(['rogue-01', 'rogue-02']);
    const r = applyCommand(mirror, catalog, { type: 'END_TURN', actorId: mirror.turn.activeUnitId! });
    expect(r.ok).toBe(true);
  });
});
