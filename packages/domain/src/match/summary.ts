/**
 * Resumo da partida para a tela de resultado (etapa 6): calculado só a partir dos eventos
 * aceitos pelo core (nada é inventado pelo cliente).
 *
 * - dano causado: `DAMAGE_APPLIED` (PV + barreira absorvida) atribuído a `cause.sourceId`
 *   quando é um personagem diferente do alvo — inclui efeitos disparados por ele (explosão do
 *   barril que ele detonou, fogo da superfície que acendeu…, conforme a causa registrada);
 * - dano recebido: todo `DAMAGE_APPLIED` no personagem, de qualquer origem;
 * - acertos/jogadas: `ATTACK_ROLLED` do atacante;
 * - cura: `HEALED` (efetiva);
 * - objetos destruídos: `OBJECT_DESTROYED` com a causa no personagem;
 * - barris detonados (Fase 5, missão "Incendiar dois barris"): `OBJECT_DESTROYED` de um barril
 *   causado pelo personagem, ou por outro barril que ele detonou (reação em cadeia).
 */
import type { EntityId } from '../core/types.js';
import type { GameEvent } from '../state/events.js';
import type { GameState } from '../state/types.js';

export interface UnitSummary {
  unitId: EntityId;
  team: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  damageDealt: number;
  damageTaken: number;
  healing: number;
  attacks: number;
  hits: number;
  objectsDestroyed: number;
  barrelsDetonated: number;
}

export interface MatchSummary {
  rounds: number;
  turns: number;
  commands: number;
  units: UnitSummary[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function summarizeMatch(state: GameState, history: readonly GameEvent[]): MatchSummary {
  const units = new Map<EntityId, UnitSummary>();
  for (const u of Object.values(state.units)) {
    if (u.flags.isDummy) continue;
    units.set(u.id, {
      unitId: u.id,
      team: u.team,
      alive: u.alive,
      hp: Math.max(0, u.hp),
      maxHp: u.maxHp,
      damageDealt: 0,
      damageTaken: 0,
      healing: 0,
      attacks: 0,
      hits: 0,
      objectsDestroyed: 0,
      barrelsDetonated: 0,
    });
  }
  let turns = 0;
  const barrelOwner = new Map<string, EntityId>();
  const commands = new Set<number>();
  for (const e of history) {
    const p = e.payload;
    if (e.cause.commandSeq !== null) commands.add(e.cause.commandSeq);
    // Dano de explosão vem do barril (causa = objeto): conta para quem o detonou.
    const sourceId = e.cause.sourceId ? (units.has(e.cause.sourceId) ? e.cause.sourceId : barrelOwner.get(e.cause.sourceId)) : undefined;
    const source = sourceId ? units.get(sourceId) : undefined;
    switch (e.type) {
      case 'TURN_STARTED':
        turns++;
        break;
      case 'DAMAGE_APPLIED': {
        const amount = num(p.hpDamage) + num(p.shieldAbsorbed);
        const target = units.get(String(p.targetId));
        if (target) target.damageTaken += amount;
        if (source && source.unitId !== p.targetId) source.damageDealt += amount;
        break;
      }
      case 'HEALED': {
        const target = units.get(String(p.unitId));
        if (target) target.healing += num(p.effective);
        break;
      }
      case 'ATTACK_ROLLED': {
        const attacker = units.get(String(p.attackerId));
        if (attacker) {
          attacker.attacks++;
          if (p.hit) attacker.hits++;
        }
        break;
      }
      case 'OBJECT_DESTROYED': {
        if (source) source.objectsDestroyed++;
        if (p.defId === 'barrel') {
          // Cadeia: o barril destruído pela explosão de outro conta para quem detonou o primeiro.
          const by = e.cause.sourceId ? (units.has(e.cause.sourceId) ? e.cause.sourceId : barrelOwner.get(e.cause.sourceId)) : undefined;
          if (by) {
            barrelOwner.set(String(p.objectId), by);
            units.get(by)!.barrelsDetonated++;
          }
        }
        break;
      }
    }
  }
  return { rounds: state.turn.round, turns, commands: commands.size, units: [...units.values()] };
}
