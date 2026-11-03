/**
 * Pré-condições das ações, como funções puras. São a única fonte de verdade:
 * o processador de comandos as usa para rejeitar, e `availability` as usa para
 * mostrar o que está disponível (UI, bot) sem duplicar regras.
 */
import { distance } from '../core/coords.js';
import type {
  AbilityDefinition,
  Catalog,
  ConsumableDefinition,
  Cost,
  WeaponDefinition,
} from '../rules/definitions.js';
import { hasStatusFlag, unitAt } from '../state/queries.js';
import type { GameState, MapObject, Unit } from '../state/types.js';
import type { CommandError, CommandErrorCode, ExecutionOptions } from './types.js';

export type Check = CommandError | null;

const err = (code: CommandErrorCode, message: string): CommandError => ({ code, message });

/** Defender: barreira de 6 até o início do próximo turno próprio (seção 2.2). */
export const DEFEND_SHIELD = { amount: 6, ownTurns: 1, cost: { ap: 1 } } as const;
export const INTERACT_COST: Cost = { ap: 1 };
export const MAX_CONSUMABLES = 2;

export function checkActor(state: GameState, actorId: string, options: ExecutionOptions = {}): Check {
  if (state.status !== 'active') return err('MATCH_NOT_ACTIVE', 'A partida não está ativa');
  const actor = state.units[actorId];
  if (!actor) return err('UNKNOWN_ACTOR', `Personagem desconhecido: ${actorId}`);
  if (!actor.alive) return err('ACTOR_DEFEATED', `${actorId} foi derrotado`);
  if (!options.ignoreTurn && state.turn.activeUnitId !== actorId) return err('WRONG_TURN', `Não é o turno de ${actorId}`);
  return null;
}

export function checkCost(actor: Unit, cost: Cost, options: ExecutionOptions = {}): Check {
  if (options.ignoreCost) return null;
  const focus = cost.focus ?? 0;
  if (actor.ap < cost.ap) return err('NOT_ENOUGH_AP', `PA insuficiente (${actor.ap}/${cost.ap})`);
  if (actor.focus < focus) return err('NOT_ENOUGH_FOCUS', `Foco insuficiente (${actor.focus}/${focus})`);
  return null;
}

export function checkDefend(actor: Unit, options: ExecutionOptions = {}): Check {
  if (actor.defendedThisTurn && !options.ignoreCooldown) return err('MAX_USES_REACHED', 'Defender só pode ser usado uma vez por turno');
  return checkCost(actor, DEFEND_SHIELD.cost, options);
}

export function checkWeapon(actor: Unit, weapon: WeaponDefinition): Check {
  if (!actor.weapons.includes(weapon.id)) return err('NOT_EQUIPPED', `${actor.id} não possui ${weapon.id}`);
  return null;
}

/** Equipamento, arma exigida, usos por turno e recarga. O custo é verificado à parte. */
export function checkAbility(catalog: Catalog, actor: Unit, ability: AbilityDefinition, options: ExecutionOptions = {}): Check {
  if (!actor.abilities.includes(ability.id) && !options.ignoreCooldown) return err('NOT_EQUIPPED', `${actor.id} não possui ${ability.id}`);
  if (ability.requiresWeaponTag && !actor.weapons.some((w) => catalog.items[w]?.tags.includes(ability.requiresWeaponTag!))) {
    return err('MISSING_WEAPON', `${ability.id} exige arma com tag ${ability.requiresWeaponTag}`);
  }
  if (!options.ignoreCooldown) {
    if ((actor.usesThisTurn[ability.id] ?? 0) >= ability.maxUsesPerTurn) return err('MAX_USES_REACHED', `${ability.id} já foi usada neste turno`);
    const availableFrom = actor.availableFromOwnTurn[ability.id] ?? 0;
    if (actor.ownTurnsStarted < availableFrom) {
      return err('ON_COOLDOWN', `Em recarga: disponível no turno próprio ${availableFrom} (atual ${actor.ownTurnsStarted})`);
    }
  }
  return null;
}

export function checkConsumable(actor: Unit, item: ConsumableDefinition): Check {
  if (!actor.consumables.includes(item.id)) return err('NOT_EQUIPPED', `${actor.id} não carrega ${item.id}`);
  return null;
}

/** Pode iniciar um deslocamento voluntário (o destino é validado à parte). */
export function checkCanMove(state: GameState, catalog: Catalog, actor: Unit): Check {
  if (actor.flags.canMove === false) return err('CANNOT_MOVE', `${actor.id} não pode se mover`);
  if (hasStatusFlag(state, catalog, actor, 'rooted')) return err('ROOTED', `${actor.id} está enraizado`);
  return null;
}

export function checkInteract(state: GameState, catalog: Catalog, actor: Unit, obj: MapObject | undefined, options: ExecutionOptions = {}): Check {
  if (!obj || obj.state === 'destroyed') return err('INVALID_TARGET', 'Objeto inválido ou destruído');
  const def = catalog.objects[obj.defId];
  if (!def?.interaction) return err('NOT_INTERACTABLE', `${obj.defId} não é interativo`);
  if (obj.pos.floor !== actor.pos.floor || distance(obj.pos, actor.pos) > 1) return err('NOT_ADJACENT', 'É preciso estar adjacente ao objeto');
  if (obj.usesLeft !== null && obj.usesLeft <= 0) return err('NO_USES_LEFT', `${obj.id} já foi utilizado`);
  const interaction = def.interaction;
  if (interaction.kind === 'grantConsumable' && (actor.consumables.length >= MAX_CONSUMABLES || actor.consumables.includes(interaction.itemId))) {
    return err('INVENTORY_FULL', 'Sem espaço para o consumível');
  }
  if (interaction.kind === 'toggleDoor' && obj.state === 'open' && unitAt(state, obj.pos)) {
    return err('CELL_OCCUPIED', 'Há um personagem na passagem');
  }
  return checkCost(actor, INTERACT_COST, options);
}
