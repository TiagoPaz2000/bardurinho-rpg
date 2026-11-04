/**
 * Descrições legíveis geradas a partir das definições do catálogo (tooltips do lab e,
 * futuramente, do cliente 3D). Nada é escrito à mão por habilidade: o texto sai das
 * operações, do alvo, do custo e da recarga — conteúdo novo ganha descrição automaticamente.
 * Se a definição tiver `description`, ela aparece como primeira linha.
 */
import { diceStats, formatDice, type Catalog, type Cost, type DamageType, type DiceExpr, type EffectOp, type TargetingRule } from '@bardurinho/domain';

/** `2d6+10 (12–22, média 17)` ou o valor fixo. */
export function formatAmount(expr: DiceExpr): string {
  if (typeof expr === 'number') return String(expr);
  const st = diceStats(expr);
  return `${formatDice(expr)} (${st.min}–${st.max}, média ${Number.isInteger(st.average) ? st.average : st.average.toFixed(1).replace('.', ',')})`;
}

const ATTACK_ROLL_TEXT = 'Jogada de ataque: d20 + bônus de ataque contra a Defesa do alvo (1 erra sempre; 20 é crítico com dados de dano em dobro). Objetos são atingidos automaticamente';

export interface Description {
  title: string;
  /** Frase de efeito (uma por operação). */
  effects: string[];
  /** Custo, alcance, recarga e restrições. */
  details: string[];
}

const DAMAGE_NAMES: Record<DamageType, string> = {
  physical: 'físico', fire: 'de fogo', cold: 'de frio', nature: 'de natureza', arcane: 'arcano',
};
const SURFACE_NAMES = { oil: 'óleo', fire: 'fogo', thorns: 'espinhos' } as const;
const STIMULUS_TEXT = {
  heat: 'Emite calor: incendeia óleo e espinhos, detona barris e queima madeira',
  cold: 'Emite frio: apaga fogo na célula e remove Queimando',
  water: 'Emite água: apaga fogo e remove Queimando',
} as const;

const who = (selector: string): string =>
  ({
    self: 'em si mesmo',
    targetCellOccupants: 'no alvo',
    crossAreaOccupants: 'em todos na área em cruz',
    blastAreaOccupants: 'em todos na área 3×3 (aliados também)',
    survivingUnitsHit: 'nos atingidos que sobreviverem',
  })[selector] ?? '';
const where = (selector: string): string =>
  ({ targetCell: 'na célula alvo', crossArea: 'em cruz (5 células)', blastArea: 'em toda a área 3×3', selfCell: 'na própria célula' })[selector] ?? '';

export function formatCost(cost: Cost): string {
  return `${cost.ap} PA${cost.focus ? ` + ${cost.focus} Foco` : ''}`;
}

export function describeTarget(t: TargetingRule): string {
  if (t.kind === 'self') return 'Alvo: próprio personagem';
  const range = t.range === undefined ? '' : t.minRange ? `${t.minRange}–${t.range} células` : t.range === 1 ? 'adjacente' : `até ${t.range} células`;
  const kind = t.kind === 'unit' ? 'personagem' : 'célula';
  const extra = [t.requiresLineOfSight ? 'exige linha de visão' : null, t.sameFloor ? 'mesmo andar' : null].filter(Boolean).join(', ');
  return `Alvo: ${kind}${range ? `, ${range}` : ''}${extra ? ` (${extra})` : ''}`;
}

export function describeEffect(catalog: Catalog, op: EffectOp): string {
  switch (op.op) {
    case 'damage':
      return `Causa ${formatAmount(op.amount)} de dano ${DAMAGE_NAMES[op.damageType]} ${who(op.selector)}${op.ignoreArmor ? ' (ignora armadura)' : ''}`
        + (op.sharedRoll ? ' — uma rolagem, o mesmo dano para todos' : '')
        + (op.save ? `; teste de resistência d20 CD ${op.save.dc}: quem passar sofre metade (1 falha sempre, 20 passa sempre)` : '');
    case 'heal':
      return `Recupera ${formatAmount(op.amount)} PV ${who(op.selector)}`;
    case 'applyStatus': {
      const st = catalog.statuses[op.statusId];
      return `Aplica ${st?.name ?? op.statusId} ${who(op.selector)}${st ? ` — ${describeStatus(catalog, op.statusId)}` : ''}`;
    }
    case 'removeStatus':
      return `Remove ${catalog.statuses[op.statusId]?.name ?? op.statusId} ${who(op.selector)}`;
    case 'grantShield':
      return `Concede barreira de ${op.amount} ${who(op.selector)} até o início do ${op.ownTurns === 1 ? 'próximo' : `${op.ownTurns}º`} turno próprio`;
    case 'restoreResource':
      return `Recupera ${formatAmount(op.amount)} ${op.resource === 'focus' ? 'Foco' : op.resource.toUpperCase()} ${who(op.selector)}`;
    case 'forceMove':
      return `Empurra ${who(op.selector)} até ${op.distance} células em linha reta`;
    case 'dashToTarget':
      return `Avança até ${op.maxCost} PM até ficar ao lado do alvo, sem gastar PM (não atravessa portas, personagens nem escadas)`;
    case 'createSurface':
      return `Cria ${SURFACE_NAMES[op.surface]} ${where(op.selector)}${op.durationRounds ? ` por ${op.durationRounds} rodadas` : ''}`;
    case 'removeSurface':
      return `Remove superfície ${where(op.selector)}`;
    case 'emitStimulus':
      return `${STIMULUS_TEXT[op.stimulus]} (${where(op.selector)})`;
    case 'changeObjectState':
      return `Muda o estado do objeto para ${op.state}`;
  }
}

export function describeStatus(catalog: Catalog, statusId: string): string {
  const st = catalog.statuses[statusId];
  if (!st) return statusId;
  const parts: string[] = [];
  if (st.tickDamage) parts.push(`${st.tickDamage.amount} de dano ${DAMAGE_NAMES[st.tickDamage.damageType]} no início do turno`);
  if (st.modifiers?.mp) parts.push(`${st.modifiers.mp > 0 ? '+' : ''}${st.modifiers.mp} PM`);
  if (st.flags?.includes('rooted')) parts.push('impede movimento voluntário');
  if (st.flags?.includes('hidden')) parts.push('não pode ser visto nem mirado à distância');
  const d = st.duration;
  if (d.kind === 'targetTurnStarts') parts.push(`${d.count} inícios de turno do alvo`);
  if (d.kind === 'targetTurns') parts.push(d.count === 1 ? 'durante o próximo turno do alvo' : `por ${d.count} turnos do alvo`);
  return parts.join(', ');
}

const cooldownText = (n: number): string =>
  n === 0 ? 'Sem recarga (1 uso por turno)' : `Recarga: bloqueada por ${n} turno${n > 1 ? 's' : ''} próprio${n > 1 ? 's' : ''} após o uso`;

/** Descrição de qualquer definição pelo id: habilidade, item, objeto ou estado. */
export function describeDefinition(catalog: Catalog, id: string): Description | null {
  const ability = catalog.abilities[id];
  if (ability) {
    return {
      title: ability.name,
      effects: [...(ability.description ? [ability.description] : []), ...ability.effects.map((op) => describeEffect(catalog, op))],
      details: [
        `Custo: ${formatCost(ability.cost)}`,
        describeTarget(ability.target),
        cooldownText(ability.blockedOwnTurnsAfterUse),
        ...(ability.attackRoll ? [ATTACK_ROLL_TEXT] : []),
        ...(ability.requiresWeaponTag ? [`Exige arma: ${ability.requiresWeaponTag}`] : []),
        ...(ability.condition === 'canHide' ? ['Só fora da visão inimiga ou em área escura; +4 de dano no primeiro ataque; termina ao atacar, sofrer dano, ser revelado ou no fim do próximo turno'] : []),
      ],
    };
  }
  const item = catalog.items[id];
  if (item) {
    switch (item.kind) {
      case 'weapon':
        return {
          title: item.name,
          effects: [`Ataque básico: ${formatAmount(item.damage)} de dano ${DAMAGE_NAMES[item.damageType]} no alvo`],
          details: [`Custo: ${formatCost(item.cost)}`, describeTarget(item.target), ATTACK_ROLL_TEXT, `Classe: ${item.classIds.map((c) => catalog.classes[c]?.name ?? c).join(', ')}`],
        };
      case 'consumable':
        return {
          title: item.name,
          effects: item.effects.map((op) => describeEffect(catalog, op)),
          details: [`Custo: ${formatCost(item.cost)}`, describeTarget(item.target), 'Consome uma unidade'],
        };
      case 'armor':
        return { title: item.name, effects: [`Armadura ${item.armor}`], details: [`Classe: ${item.classIds.join(', ')}`] };
      case 'accessory':
        return {
          title: item.name,
          effects: [
            ...(item.maxHpBonus ? [`+${item.maxHpBonus} PV máximos`] : []),
            ...Object.entries(item.resistances ?? {}).map(([k, v]) => `Resistência ${DAMAGE_NAMES[k as DamageType]} ${v}`),
          ],
          details: ['Um acessório equipado'],
        };
    }
  }
  const obj = catalog.objects[id];
  if (obj) {
    const interaction = obj.interaction
      ? {
          toggleDoor: 'Abre ou fecha a porta',
          toggleLinked: 'Abre ou fecha o portão ligado à alavanca',
          grantConsumable: `Concede ${catalog.items[(obj.interaction as { itemId?: string }).itemId ?? '']?.name ?? 'um consumível'} (exige espaço no inventário)`,
          restoreFocus: `Recupera ${formatAmount((obj.interaction as { amount?: DiceExpr }).amount ?? 0)} Foco`,
          emitWater: 'Apaga o fogo em cruz ao redor da cisterna',
        }[obj.interaction.kind]
      : null;
    return {
      title: obj.name,
      effects: [interaction ?? 'Sem interação', ...(obj.explosion ? [`Explode: ${obj.explosion.damage} de dano ${DAMAGE_NAMES[obj.explosion.damageType]} ao redor`] : [])],
      details: [
        'Custo: 1 PA · exige estar adjacente',
        obj.hp === null ? 'Indestrutível' : `${obj.hp} PV${obj.flammable ? ' · inflamável' : ''}`,
        ...(obj.maxUses ? [`${obj.maxUses} uso${obj.maxUses > 1 ? 's' : ''} por partida`] : []),
      ],
    };
  }
  const status = catalog.statuses[id];
  if (status) return { title: status.name, effects: [describeStatus(catalog, id)], details: [] };
  return null;
}

/** Descrições das ações básicas que não vêm de definições do catálogo. */
export const BASIC_ACTION_DESCRIPTIONS: Record<string, Description> = {
  'action.move': {
    title: 'Mover',
    effects: ['Desloca o personagem em 4 direções, gastando PM pelo percurso'],
    details: ['Óleo e espinhos custam 2 PM; escadas custam 2 PM', 'Fogo e espinhos causam dano ao entrar', 'Pode intercalar com ataques e ações'],
  },
  'action.defend': {
    title: 'Defender',
    effects: ['Concede barreira de 6 até o início do próximo turno próprio'],
    details: ['Custo: 1 PA', 'Uma vez por turno', 'Barreiras não somam: a mais forte prevalece'],
  },
  'action.end_turn': {
    title: 'Encerrar turno',
    effects: ['Passa a vez ao próximo personagem'],
    details: ['PA e PM não utilizados não são acumulados'],
  },
};
