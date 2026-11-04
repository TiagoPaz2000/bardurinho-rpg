/**
 * Fase 5 — regras puras de progressão (conteúdo): tabela de moedas (seção 12.3), estatísticas
 * de participante a partir do resultado oficial, missões, cosméticos e validação de nomes.
 */
import { describe, expect, it } from 'vitest';
import {
  COSMETIC_SLOTS,
  DEFAULT_APPEARANCE,
  appearanceProblem,
  characterNameProblem,
  cosmetics,
  cosmeticsById,
  matchCoins,
  missionIncrement,
  missionPeriod,
  missions,
  missionsById,
  normalizeAppearance,
  participantStats,
  passwordProblem,
  shopProducts,
  usernameProblem,
} from '@bardurinho/content';
import { summarizeMatch, type GameEvent } from '@bardurinho/domain';
import { cell, run, scenario } from './helpers.js';

describe('moedas por partida (seção 12.3)', () => {
  it('PvP 30/10/15, contra bot 10 na vitória; quem se rende não recebe; personalizada não paga', () => {
    expect(matchCoins('pvp', 'victory', false)).toBe(30);
    expect(matchCoins('pvp', 'defeat', false)).toBe(10);
    expect(matchCoins('pvp', 'draw', false)).toBe(15);
    expect(matchCoins('private', 'victory', false)).toBe(30);
    expect(matchCoins('bot', 'victory', false)).toBe(10);
    expect(matchCoins('bot', 'defeat', false)).toBe(3);
    expect(matchCoins('pvp', 'defeat', true)).toBe(0);
    expect(matchCoins('custom', 'victory', false)).toBe(0);
  });
});

describe('estatísticas do participante e missões', () => {
  it('barril detonado (e em cadeia) conta para quem acendeu; vitória, dano e conclusão', () => {
    let state = scenario({
      units: [
        { id: 'mage-01', classId: 'mage', team: 'A', pos: { x: 2, y: 2 } },
        { id: 'warrior-01', classId: 'warrior', team: 'B', pos: { x: 6, y: 5 }, hp: 10 },
      ],
      objects: [
        { id: 'barrel-01', defId: 'barrel', pos: { x: 4, y: 4 } },
        { id: 'barrel-02', defId: 'barrel', pos: { x: 5, y: 4 } },
      ],
      order: ['mage-01', 'warrior-01'],
    });
    const events: GameEvent[] = [];
    const r = run(state, { type: 'BASIC_ATTACK', actorId: 'mage-01', weaponId: 'weapon.arcane_wand', target: cell(4, 4) });
    state = r.state;
    events.push(...r.events);
    const sum = summarizeMatch(state, events);
    expect(sum.units.find((u) => u.unitId === 'mage-01')!.barrelsDetonated).toBe(2);
    expect(state.status).toBe('finished'); // a cadeia derrubou o Guerreiro
    const a = participantStats(state, events, 'A');
    expect(a).toMatchObject({ outcome: 'victory', completed: true, surrendered: false, barrelsDetonated: 2 });
    expect(a.damageDealt).toBeGreaterThan(0);
    const b = participantStats(state, events, 'B');
    expect(b).toMatchObject({ outcome: 'defeat', completed: true, barrelsDetonated: 0 });
    expect(missionIncrement(missionsById['mission.two_barrels']!, a)).toBe(2);
    expect(missionIncrement(missionsById['mission.first_win']!, a)).toBe(1);
    expect(missionIncrement(missionsById['mission.first_win']!, b)).toBe(0);
    expect(missionIncrement(missionsById['mission.complete_three']!, b)).toBe(1);
  });

  it('render-se: derrota sem conclusão (não conta missões); o adversário vence', () => {
    let state = scenario({
      units: [
        { id: 'w', classId: 'warrior', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'm', classId: 'mage', team: 'B', pos: { x: 6, y: 6 } },
      ],
      order: ['w', 'm'],
    });
    const r = run(state, { type: 'SURRENDER', actorId: 'w' });
    state = r.state;
    const a = participantStats(state, r.events, 'A');
    expect(a).toMatchObject({ outcome: 'defeat', surrendered: true, completed: false });
    for (const m of missions) expect(missionIncrement(m, a)).toBe(0);
    expect(participantStats(state, r.events, 'B')).toMatchObject({ outcome: 'victory', completed: true });
  });

  it('missões do plano + diárias; período diário pela data UTC', () => {
    expect(missions.filter((m) => m.period === 'permanent').map((m) => m.reward.cosmeticId)).toEqual(['color.veteran', 'frame.gold', 'aura.ember']);
    for (const m of missions) if (m.reward.cosmeticId) expect(cosmeticsById[m.reward.cosmeticId]?.source).toBe('mission');
    expect(missionPeriod(missionsById['daily.play_one']!, new Date('2026-11-03T23:59:00Z'))).toBe('2026-11-03');
    expect(missionPeriod(missionsById['mission.first_win']!)).toBe('perm');
  });
});

describe('cosméticos e loja (sem vantagem de atributos)', () => {
  it('loja só com cosméticos com preço; padrões gratuitos; preços do plano', () => {
    const shop = shopProducts();
    expect(shop.length).toBeGreaterThanOrEqual(8);
    expect(shop.every((x) => x.price! > 0 && !x.free && x.source === 'shop')).toBe(true);
    expect(cosmeticsById['color.gold']!.price).toBe(50); // cor alternativa
    expect(cosmeticsById['portrait.lion']!.price).toBe(80); // retrato
    expect(cosmeticsById['outfit.ceremonial']!.price).toBe(200); // aparência de classe
    for (const slot of COSMETIC_SLOTS) expect(cosmeticsById[DEFAULT_APPEARANCE[slot]]?.free).toBe(true);
    // Nenhum cosmético mexe em atributo de combate: só apresentação.
    for (const c of cosmetics) expect(Object.keys(c.presentation).every((k) => ['tint', 'tintStrength', 'emissive', 'emissiveStrength', 'ring', 'emblem', 'background', 'border'].includes(k))).toBe(true);
  });

  it('aparência: só itens do espaço certo e possuídos', () => {
    expect(normalizeAppearance({ color: 'color.gold', outfit: 'color.ruby', aura: 'aura.none' }, [])).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ color: 'color.gold' }, ['color.gold']).color).toBe('color.gold');
    expect(appearanceProblem({ color: 'color.gold' }, [])).toMatch(/não possui/);
    expect(appearanceProblem({ color: 'outfit.spectral' }, ['outfit.spectral'])).toMatch(/inválido/);
    expect(appearanceProblem({ hat: 'x' }, [])).toMatch(/desconhecido/);
    expect(appearanceProblem({ color: 'color.ruby', frame: 'frame.none' }, [])).toBeNull();
  });

  it('nome do personagem, usuário e senha', () => {
    expect(characterNameProblem('Ana')).toBeNull();
    expect(characterNameProblem('Élfa da Névoa')).toBeNull();
    expect(characterNameProblem('ab')).toMatch(/3 a 16/);
    expect(characterNameProblem('<script>')).toMatch(/letras/);
    expect(usernameProblem('jogador_1')).toBeNull();
    expect(usernameProblem('Jogador')).not.toBeNull();
    expect(passwordProblem('12345')).not.toBeNull();
    expect(passwordProblem('123456')).toBeNull();
  });
});
