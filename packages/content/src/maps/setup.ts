/**
 * Montagem de uma partida (Fase 4): equipes A e B com 1 ou 2 personagens cada, escolhendo
 * classe, acessório e até dois consumíveis de tipos diferentes (seções 2.1, 3.2 e 3.3).
 *
 * É só dado: o resultado é um `ScenarioInitial` do mapa com os personagens nos pontos de
 * início — as regras continuam no core. Usado pelo cliente local (tela de escolha /
 * `?setup=`), pelo servidor (opções de cada assento) e pelos testes.
 */
import type { Catalog, ScenarioInitial, ScenarioPos } from '@bardurinho/domain';
import type { MapDefinition } from './index.js';

export type TeamId = 'A' | 'B';
export const TEAMS: readonly TeamId[] = ['A', 'B'];
export const MAX_TEAM_SIZE = 2;
export const MAX_START_CONSUMABLES = 2;

export interface CharacterChoice {
  classId: string;
  /** Fase 5: nome do personagem (só exibição; validado pelo servidor ao criar o personagem). */
  name?: string;
  accessoryId?: string | null;
  /** Até dois consumíveis de tipos diferentes (ids completos, ex.: `consumable.health_potion`). */
  consumables?: string[];
}

export interface MatchSetup {
  teams: Record<TeamId, CharacterChoice[]>;
}

/** Escolha padrão de cada classe: sem acessório, Poção de vida + Poção de Foco (seção 3.3). */
export const DEFAULT_CONSUMABLES = ['consumable.health_potion', 'consumable.focus_potion'];

/** Duelo padrão do mapa (Guerreiro A × Mago B), com os consumíveis iniciais. */
export const DEFAULT_SETUP: MatchSetup = {
  teams: {
    A: [{ classId: 'warrior', accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] }],
    B: [{ classId: 'mage', accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] }],
  },
};

/** Classe padrão por equipe e posição (1 × 1: Guerreiro × Mago; 2 × 2: + Ladino × Druida). */
export const DEFAULT_CLASSES: Record<TeamId, string[]> = { A: ['warrior', 'rogue'], B: ['mage', 'druid'] };

/**
 * Corrige uma escolha vinda da interface ou da rede: classe conhecida (senão a padrão),
 * acessório só se for acessório, consumíveis conhecidos, sem repetir tipo, no máximo dois.
 */
export function normalizeChoice(catalog: Catalog, raw: Partial<CharacterChoice> | null | undefined, fallbackClass: string): CharacterChoice {
  const classId = typeof raw?.classId === 'string' && catalog.classes[raw.classId] ? raw.classId : fallbackClass;
  const acc = typeof raw?.accessoryId === 'string' ? withPrefix(raw.accessoryId, 'accessory.') : null;
  const accessoryId = acc && catalog.items[acc]?.kind === 'accessory' ? acc : null;
  const consumables: string[] = [];
  for (const c of Array.isArray(raw?.consumables) ? raw!.consumables : []) {
    if (typeof c !== 'string') continue;
    const id = withPrefix(c, 'consumable.');
    if (catalog.items[id]?.kind !== 'consumable' || consumables.includes(id)) continue;
    if (consumables.length < MAX_START_CONSUMABLES) consumables.push(id);
  }
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : undefined;
  return { classId, accessoryId, consumables, ...(name ? { name } : {}) };
}

const withPrefix = (id: string, prefix: string) => (id.includes('.') ? id : `${prefix}${id}`);

/** Equipe com 1–2 personagens; `size` força o tamanho (completa com a classe padrão). */
export function normalizeTeam(catalog: Catalog, team: TeamId, raw: unknown, size?: number): CharacterChoice[] {
  const list = Array.isArray(raw) ? raw : [];
  const n = Math.max(1, Math.min(MAX_TEAM_SIZE, size ?? (list.length || 1)));
  return Array.from({ length: n }, (_, i) => normalizeChoice(catalog, list[i] as Partial<CharacterChoice> | undefined, DEFAULT_CLASSES[team][i] ?? 'warrior'));
}

export function normalizeSetup(catalog: Catalog, raw: Partial<MatchSetup> | null | undefined): MatchSetup {
  return { teams: { A: normalizeTeam(catalog, 'A', raw?.teams?.A), B: normalizeTeam(catalog, 'B', raw?.teams?.B) } };
}

export interface SetupOptions {
  /**
   * Fase 6: `opaque` gera ids sem a classe (`unit-a1`, `unit-b1`…) — usado pelo servidor, para
   * que a ordem de iniciativa / `activeUnitId` (públicos) não revele a classe do adversário
   * oculto. Padrão `class` (`warrior-01`), usado no modo local, no Lab e nos cenários.
   */
  ids?: 'class' | 'opaque';
}

/** Id opaco de um personagem: só a equipe e a posição (públicas). */
export const opaqueUnitId = (team: TeamId, index: number): string => `unit-${team.toLowerCase()}${index + 1}`;

/**
 * Cenário do mapa com os personagens escolhidos nos pontos de início da equipe (o 1º no
 * ponto principal). Ids: `<classe>-0N`, N contado por classe na ordem A1, A2, B1, B2 (o duelo
 * padrão continua `warrior-01` × `mage-01`; classes repetidas ganham 02). A ordem de turnos
 * continua decidida pelo d20 da iniciativa do mapa.
 */
export function scenarioFromSetup(mapDef: MapDefinition, catalog: Catalog, setup: MatchSetup, options: SetupOptions = {}): ScenarioInitial {
  const norm = normalizeSetup(catalog, setup);
  const units: NonNullable<ScenarioInitial['units']> = [];
  const perClass = new Map<string, number>();
  for (const team of TEAMS) {
    const spawns = mapDef.spawns[team];
    norm.teams[team].forEach((c, i) => {
      const pos = spawns[i];
      if (!pos) throw new Error(`Mapa ${mapDef.id} sem ponto de início ${i + 1} para a equipe ${team}`);
      const n = (perClass.get(c.classId) ?? 0) + 1;
      perClass.set(c.classId, n);
      units.push({
        id: options.ids === 'opaque' ? opaqueUnitId(team, i) : `${c.classId}-${String(n).padStart(2, '0')}`,
        classId: c.classId,
        team,
        pos: { ...pos },
        ...(c.name ? { name: c.name } : {}),
        accessoryId: c.accessoryId ?? null,
        consumables: [...(c.consumables ?? [])],
      });
    });
  }
  return { ...mapDef.scenario, units, order: units.map((u) => u.id) };
}

// ---------------------------------------------------------------------------
// Texto curto para a URL (`?setup=`): "A=warrior:vitality_amulet:health_potion,focus_potion|rogue;B=mage"
// ---------------------------------------------------------------------------

const short = (id: string | null | undefined) => (id ? id.replace(/^(accessory|consumable)\./, '') : '');

export function encodeSetup(setup: MatchSetup): string {
  return TEAMS.map(
    (t) => `${t}=${setup.teams[t].map((c) => [c.classId, short(c.accessoryId), (c.consumables ?? []).map(short).join(',')].join(':').replace(/:+$/, '')).join('|')}`,
  ).join(';');
}

export function decodeSetup(catalog: Catalog, text: string): MatchSetup | null {
  const teams: Partial<Record<TeamId, Array<Partial<CharacterChoice>>>> = {};
  for (const part of text.split(';')) {
    const [team, body] = part.split('=');
    if ((team !== 'A' && team !== 'B') || !body) continue;
    teams[team] = body.split('|').map((entry) => {
      const [classId, accessoryId, consumables] = entry.split(':');
      return { classId: classId ?? '', accessoryId: accessoryId || null, consumables: consumables ? consumables.split(',') : [] };
    });
  }
  if (!teams.A && !teams.B) return null;
  return normalizeSetup(catalog, { teams: { A: teams.A ?? [], B: teams.B ?? [] } as MatchSetup['teams'] });
}

/** Posições de início válidas (usado pelos testes de conteúdo do mapa). */
export function allSpawns(mapDef: MapDefinition): ScenarioPos[] {
  return TEAMS.flatMap((t) => mapDef.spawns[t]);
}
