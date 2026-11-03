import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@bardurinho/domain';
import { summarizeMatch } from '../../apps/web/src/game/matchSummary.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../apps/web/src/screens/settings.js';
import { endTurn, entity, run, scenario } from './helpers.js';

describe('resumo da partida (tela de resultado, Fase 2 etapa 6)', () => {
  it('conta dano causado/recebido, jogadas de ataque, turnos e comandos a partir dos eventos', () => {
    let state = scenario({
      units: [
        { id: 'w', classId: 'warrior', team: 'A', pos: { x: 1, y: 1 } },
        { id: 'm', classId: 'mage', team: 'B', pos: { x: 2, y: 1 } },
      ],
      order: ['w', 'm'],
      dice: 'random',
      seed: 3,
    });
    const history: GameEvent[] = [];
    const step = (cmd: Parameters<typeof run>[1]) => {
      const r = run(state, cmd);
      state = r.state;
      history.push(...r.events);
    };
    // O guerreiro ataca até o mago cair (o mago só encerra o turno).
    for (let i = 0; i < 40 && state.status === 'active'; i++) {
      const active = state.turn.activeUnitId!;
      if (active === 'w' && state.units.w!.ap > 0) step({ type: 'BASIC_ATTACK', actorId: 'w', weaponId: 'weapon.iron_sword', target: entity('m') });
      else step(endTurn(active));
    }
    expect(state.status).toBe('finished');
    const sum = summarizeMatch(state, history);
    const w = sum.units.find((u) => u.unitId === 'w')!;
    const m = sum.units.find((u) => u.unitId === 'm')!;
    const rolls = history.filter((e) => e.type === 'ATTACK_ROLLED');
    expect(w.attacks).toBe(rolls.length);
    expect(w.hits).toBe(rolls.filter((e) => e.payload.hit).length);
    // Todo o dano do mago veio do guerreiro; o mago terminou derrotado.
    expect(m.damageTaken).toBe(w.damageDealt);
    expect(w.damageDealt).toBeGreaterThanOrEqual(80);
    expect(m.alive).toBe(false);
    expect(w.damageTaken).toBe(0);
    expect(sum.rounds).toBe(state.turn.round);
    expect(sum.turns).toBe(history.filter((e) => e.type === 'TURN_STARTED').length);
    expect(sum.commands).toBeGreaterThan(0);
  });
});

describe('preferências do cliente (tela de opções)', () => {
  it('valores inválidos voltam ao padrão; sensibilidade é limitada a 0,5–2', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ autoCamera: 'xyz', cameraSensitivity: 9, invertDrag: 'sim' })).toEqual({ ...DEFAULT_SETTINGS, cameraSensitivity: 2 });
    expect(normalizeSettings({ autoCamera: 'off', cameraSensitivity: 0.74, invertZoom: true, cameraShake: false })).toEqual({
      autoCamera: 'off',
      cameraSensitivity: 0.7,
      invertDrag: false,
      invertZoom: true,
      cameraShake: false,
      sfxVolume: DEFAULT_SETTINGS.sfxVolume,
    });
    // Fase 4: volume dos efeitos sonoros (0 = mudo), limitado a 0–1.
    expect(normalizeSettings({ sfxVolume: 3 }).sfxVolume).toBe(1);
    expect(normalizeSettings({ sfxVolume: 0 }).sfxVolume).toBe(0);
    expect(normalizeSettings({ sfxVolume: 'x' }).sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
  });
});
