/**
 * Casos do roteiro de conteúdo da Fase 4 (tools/e2e/conteudo.ts): cada caso é uma partida
 * local do Pátio das Ruínas com classes/acessórios/consumíveis (`?setup=`), posições
 * (`?units=`) e dados em "média fixa" (`?dice=average`), e uma sequência de jogadas feitas
 * pela interface. `simulateCase` roda a mesma sequência direto no core — o roteiro confere
 * antes que todas as jogadas são válidas e, no fim, que o cliente chegou ao mesmo estado.
 */
import { catalog, encodeSetup, patioDasRuinas, scenarioFromSetup, type MatchSetup } from '@bardurinho/content';
import { applyCommand, buildScenario, type Command, type Coord, type GameEvent, type GameState } from '@bardurinho/domain';

export type Step =
  /** Carta da barra (`ActionInfo.key`); com alvo, clica na célula `at`. */
  | { t: 'card'; key: string; at?: Coord; note?: string }
  /** Clica no objeto (painel do alvo) e no botão de interação. */
  | { t: 'interact'; object: string; note?: string }
  | { t: 'move'; to: Coord }
  | { t: 'end' }
  /** Confere que a carta está indisponível e que o motivo contém o texto (sem jogar). */
  | { t: 'blocked'; key: string; reason: string };

export interface ContentCase {
  name: string;
  title: string;
  setup: MatchSetup;
  /** Posições (`?units=` por cima do setup, na ordem A1, A2, B1, B2). */
  positions: Array<{ x: number; y: number; floor?: number }>;
  steps: Step[];
}

const c = (x: number, y: number, floor = 0): Coord => ({ x, y, floor });

export const CASES: ContentCase[] = [
  {
    name: 'mago-guerreiro',
    title: 'Mago × Guerreiro: Chama, Geada, Barreira, Varinha, Frasco de óleo; Investida, Empurrão, Espada, Defender; poções; medalhões',
    setup: {
      teams: {
        A: [{ classId: 'mage', accessoryId: 'accessory.ash_medallion', consumables: ['consumable.oil_flask', 'consumable.health_potion'] }],
        B: [{ classId: 'warrior', accessoryId: 'accessory.frost_medallion', consumables: ['consumable.health_potion', 'consumable.focus_potion'] }],
      },
    },
    positions: [c(8, 3), c(8, 5)],
    steps: [
      { t: 'card', key: 'ability:mage.flame', at: c(8, 5), note: 'Queimando' },
      { t: 'card', key: 'ability:mage.frost_ray', at: c(8, 5), note: 'Lentidão; frio remove Queimando; resistência a frio 2' },
      { t: 'end' },
      { t: 'card', key: 'ability:warrior.charge', at: c(8, 3) },
      { t: 'card', key: 'ability:warrior.push', at: c(8, 3) },
      { t: 'end' },
      { t: 'blocked', key: 'ability:mage.frost_ray', reason: 'recarga' },
      { t: 'card', key: 'ability:mage.arcane_barrier' },
      { t: 'card', key: 'item:consumable.oil_flask', at: c(8, 4), note: 'óleo em cruz sob o guerreiro' },
      { t: 'end' },
      { t: 'move', to: c(8, 2) },
      { t: 'card', key: 'attack:weapon.iron_sword', at: c(8, 1), note: 'barreira absorve' },
      { t: 'card', key: 'defend' },
      { t: 'end' },
      { t: 'card', key: 'ability:mage.flame', at: c(9, 4), note: 'calor + óleo: a mancha vira fogo' },
      { t: 'card', key: 'attack:weapon.arcane_wand', at: c(6, 3), note: 'caixote' },
      { t: 'end' },
      { t: 'card', key: 'item:consumable.health_potion' },
      { t: 'card', key: 'item:consumable.focus_potion' },
      { t: 'end' },
      { t: 'card', key: 'item:consumable.health_potion' },
      { t: 'end' },
    ],
  },
  {
    name: 'ladino-druida',
    title: 'Ladino × Druida: Ocultação (área escura), Tiro preciso, Arco, Adaga; Enraizar, Espinheiro, Cura natural, Cajado; baú; amuleto',
    setup: {
      teams: {
        A: [{ classId: 'rogue', accessoryId: 'accessory.vitality_amulet', consumables: ['consumable.health_potion', 'consumable.focus_potion'] }],
        B: [{ classId: 'druid', accessoryId: null, consumables: ['consumable.oil_flask'] }],
      },
    },
    positions: [c(14, 1), c(13, 4)],
    steps: [
      { t: 'card', key: 'ability:rogue.hide', note: 'área escura, inimigo a 4 células' },
      { t: 'card', key: 'ability:rogue.precise_shot', at: c(13, 4), note: '+4 saindo de Oculto' },
      { t: 'end' },
      { t: 'interact', object: 'chest-01', note: 'baú: Poção de vida' },
      { t: 'move', to: c(14, 3) },
      { t: 'card', key: 'ability:druid.root', at: c(14, 1) },
      { t: 'end' },
      { t: 'blocked', key: 'move', reason: 'enraizado' },
      { t: 'card', key: 'attack:weapon.short_bow', at: c(14, 3) },
      { t: 'card', key: 'item:consumable.health_potion' },
      { t: 'end' },
      { t: 'card', key: 'ability:druid.thorns', at: c(14, 1), note: 'cruz de espinhos sob o ladino' },
      { t: 'card', key: 'attack:weapon.nature_staff', at: c(14, 1) },
      { t: 'end' },
      { t: 'move', to: c(14, 2) },
      { t: 'card', key: 'attack:weapon.dagger', at: c(14, 3) },
      { t: 'card', key: 'item:consumable.focus_potion' },
      { t: 'end' },
      { t: 'card', key: 'ability:druid.natural_heal' },
      { t: 'card', key: 'item:consumable.health_potion' },
      { t: 'end' },
    ],
  },
  {
    name: 'ambiente',
    title: 'Ambiente: frasco + Chama (óleo em chamas, Queimando), cisterna (água apaga fogo e Queimando), alavanca e portão, altar, porta, barril explosivo',
    setup: {
      teams: {
        A: [{ classId: 'mage', accessoryId: null, consumables: ['consumable.oil_flask'] }],
        B: [{ classId: 'warrior', accessoryId: null, consumables: [] }],
      },
    },
    positions: [c(8, 2), c(9, 3)],
    steps: [
      { t: 'card', key: 'item:consumable.oil_flask', at: c(10, 3) },
      { t: 'card', key: 'ability:mage.flame', at: c(9, 3), note: 'Queimando + mancha de óleo vira fogo' },
      { t: 'end' },
      { t: 'card', key: 'defend' },
      { t: 'end' },
      { t: 'interact', object: 'cistern-01', note: 'água apaga fogo e Queimando' },
      { t: 'card', key: 'attack:weapon.arcane_wand', at: c(9, 3) },
      { t: 'end' },
      { t: 'move', to: c(8, 5) },
      { t: 'interact', object: 'lever-01', note: 'alavanca abre o portão' },
      { t: 'end' },
      { t: 'move', to: c(3, 2) },
      { t: 'end' },
      { t: 'move', to: c(7, 6) },
      { t: 'end' },
      { t: 'move', to: c(2, 1) },
      { t: 'interact', object: 'altar-01', note: 'altar de Foco' },
      { t: 'end' },
      { t: 'end' },
      { t: 'move', to: c(2, 6) },
      { t: 'interact', object: 'door-01', note: 'abrir porta' },
      { t: 'end' },
      { t: 'end' },
      { t: 'card', key: 'ability:mage.flame', at: c(5, 5), note: 'barril explode e incendeia o óleo do mapa' },
      { t: 'end' },
    ],
  },
  {
    name: 'bola-de-fogo',
    title: 'Bola de fogo: área 3×3, uma rolagem para todos, teste de resistência d20 (metade), Queimando',
    setup: {
      teams: {
        A: [{ classId: 'mage', accessoryId: null, consumables: [] }],
        B: [{ classId: 'warrior', accessoryId: null, consumables: [] }],
      },
    },
    positions: [c(8, 2), c(8, 5)],
    steps: [
      { t: 'card', key: 'ability:mage.fireball', at: c(8, 5), note: 'explosão 3×3; d20 médio (11) falha a CD 13: 18 de fogo + Queimando' },
      { t: 'end' },
      { t: 'card', key: 'defend' },
      { t: 'end' },
      { t: 'blocked', key: 'ability:mage.fireball', reason: 'recarga' },
      { t: 'end' },
    ],
  },
];

export function caseUrl(k: ContentCase, base = 'http://127.0.0.1:5173/', seed = 4): string {
  const all = [...k.setup.teams.A, ...k.setup.teams.B];
  const units = k.positions.map((p, i) => `${all[i]!.classId}@${p.x},${p.y}${p.floor ? `,${p.floor}` : ''}`);
  const q = new URLSearchParams({ setup: encodeSetup(k.setup), units: units.join(';'), seed: String(seed), dice: 'average' });
  return `${base}?${q.toString()}`;
}

/** Estado inicial igual ao do cliente (mesmo `scenarioOverride`: setup + posições). */
export function caseState(k: ContentCase, seed = 4): GameState {
  const scenario = scenarioFromSetup(patioDasRuinas, catalog, k.setup);
  const units = scenario.units!.map((u, i) => ({ ...u, pos: { ...k.positions[i]!, floor: k.positions[i]!.floor ?? 0 } }));
  return buildScenario(catalog, { ...scenario, units, dice: 'average', seed });
}

/** Comando equivalente a um passo (alvo pela célula, como o clique na célula do canvas). */
export function stepCommand(state: GameState, step: Step): Command | null {
  const actorId = state.turn.activeUnitId!;
  switch (step.t) {
    case 'end':
      return { type: 'END_TURN', actorId };
    case 'move':
      return { type: 'MOVE', actorId, to: step.to };
    case 'interact':
      return { type: 'INTERACT', actorId, objectId: step.object };
    case 'blocked':
      return null;
    case 'card': {
      if (step.key === 'defend') return { type: 'DEFEND', actorId };
      const [kind, id] = step.key.split(':');
      const target = step.at ? { kind: 'cell' as const, ...step.at } : { kind: 'self' as const };
      if (kind === 'ability') return { type: 'USE_ABILITY', actorId, abilityId: id!, target };
      if (kind === 'attack') return { type: 'BASIC_ATTACK', actorId, weaponId: id!, target };
      if (kind === 'item') return { type: 'USE_ITEM', actorId, itemId: id!, ...(step.at ? { target } : {}) };
      return null;
    }
  }
}

export function simulateCase(k: ContentCase): { state: GameState; events: GameEvent[]; errors: string[] } {
  let state = caseState(k);
  const events: GameEvent[] = [];
  const errors: string[] = [];
  k.steps.forEach((step, i) => {
    const cmd = stepCommand(state, step);
    if (!cmd) return;
    const r = applyCommand(state, catalog, cmd);
    if (!r.ok) errors.push(`#${i} ${JSON.stringify(step)} → ${r.error.code}: ${r.error.message}`);
    else {
      state = r.state;
      events.push(...r.events);
    }
  });
  return { state, events, errors };
}
