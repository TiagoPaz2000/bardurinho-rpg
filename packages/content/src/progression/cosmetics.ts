/**
 * Cosméticos (Fase 5, seções 1 e 12): aparência do personagem, retratos, molduras e auras.
 *
 * Princípio do plano: "A progressão não dará vantagem permanente de atributos no PvP" — a
 * loja só vende cosméticos; armas/armaduras são fixas por classe e todos os acessórios e
 * consumíveis de combate estão disponíveis desde o início (seção 3.2).
 *
 * É só dado: o servidor valida posse/preço; o cliente aplica `presentation` sobre os GLBs
 * da classe (tinta, emissivo, cor do anel) e desenha retratos/molduras.
 */

export type CosmeticSlot = 'color' | 'outfit' | 'portrait' | 'frame' | 'aura';
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['color', 'outfit', 'portrait', 'frame', 'aura'];

export interface CosmeticPresentation {
  /** Cor multiplicada no albedo dos materiais do modelo (hex). */
  tint?: string;
  /** 0–1: quanto da tinta entra (0 = cor original do GLB). */
  tintStrength?: number;
  /** Brilho emissivo somado aos materiais (hex) e intensidade. */
  emissive?: string;
  emissiveStrength?: number;
  /** Cor do anel/disco sob o personagem (aura). */
  ring?: string;
  /** Retrato: forma do emblema (SVG desenhado pelo cliente) e cor de fundo. */
  emblem?: 'class' | 'lion' | 'raven' | 'flame' | 'tree';
  background?: string;
  /** Moldura do retrato. */
  border?: string;
}

export interface CosmeticDefinition {
  id: string;
  slot: CosmeticSlot;
  name: string;
  description: string;
  /** Preço em moedas na loja; `null` = não vendido (padrão ou recompensa de missão). */
  price: number | null;
  /** Disponível para todos desde a criação (não precisa estar no inventário). */
  free: boolean;
  /** De onde vem (texto para a interface). */
  source: 'base' | 'shop' | 'mission';
  presentation: CosmeticPresentation;
}

const c = (d: CosmeticDefinition) => d;

export const cosmetics: CosmeticDefinition[] = [
  // --- Cores (tinta sobre o modelo da classe) -------------------------------------------
  c({ id: 'color.natural', slot: 'color', name: 'Natural', description: 'Cores originais da classe.', price: null, free: true, source: 'base', presentation: {} }),
  c({ id: 'color.ruby', slot: 'color', name: 'Rubi', description: 'Tons de vermelho.', price: null, free: true, source: 'base', presentation: { tint: '#e0464a', tintStrength: 0.8 } }),
  c({ id: 'color.sapphire', slot: 'color', name: 'Safira', description: 'Tons de azul.', price: null, free: true, source: 'base', presentation: { tint: '#3d7be0', tintStrength: 0.8 } }),
  c({ id: 'color.jade', slot: 'color', name: 'Jade', description: 'Tons de verde.', price: null, free: true, source: 'base', presentation: { tint: '#3fae6a', tintStrength: 0.8 } }),
  c({ id: 'color.gold', slot: 'color', name: 'Ouro velho', description: 'Cor alternativa dourada.', price: 50, free: false, source: 'shop', presentation: { tint: '#e6b422', tintStrength: 0.85 } }),
  c({ id: 'color.obsidian', slot: 'color', name: 'Obsidiana', description: 'Cor alternativa quase negra.', price: 50, free: false, source: 'shop', presentation: { tint: '#3a3a46', tintStrength: 0.85 } }),
  c({ id: 'color.violet', slot: 'color', name: 'Violeta', description: 'Cor alternativa púrpura.', price: 50, free: false, source: 'shop', presentation: { tint: '#9b5de5', tintStrength: 0.8 } }),
  c({ id: 'color.veteran', slot: 'color', name: 'Veterano', description: 'Bronze e verde-água. Recompensa de "Concluir três partidas".', price: null, free: false, source: 'mission', presentation: { tint: '#2bb3a3', tintStrength: 0.8 } }),

  // --- Aparência de classe (conjunto visual) --------------------------------------------
  c({ id: 'outfit.standard', slot: 'outfit', name: 'Padrão', description: 'Conjunto visual de origem.', price: null, free: true, source: 'base', presentation: {} }),
  c({ id: 'outfit.ceremonial', slot: 'outfit', name: 'Cerimonial', description: 'Detalhes dourados que brilham.', price: 200, free: false, source: 'shop', presentation: { emissive: '#ffcf4d', emissiveStrength: 0.35 } }),
  c({ id: 'outfit.spectral', slot: 'outfit', name: 'Espectral', description: 'Brilho azul-fantasma.', price: 200, free: false, source: 'shop', presentation: { emissive: '#66d9ff', emissiveStrength: 0.45 } }),

  // --- Retratos ------------------------------------------------------------------------
  c({ id: 'portrait.class', slot: 'portrait', name: 'Brasão da classe', description: 'O ícone da sua classe.', price: null, free: true, source: 'base', presentation: { emblem: 'class', background: '#2b2f36' } }),
  c({ id: 'portrait.lion', slot: 'portrait', name: 'Leão', description: 'Retrato do leão coroado.', price: 80, free: false, source: 'shop', presentation: { emblem: 'lion', background: '#7a4b12' } }),
  c({ id: 'portrait.raven', slot: 'portrait', name: 'Corvo', description: 'Retrato do corvo noturno.', price: 80, free: false, source: 'shop', presentation: { emblem: 'raven', background: '#283044' } }),
  c({ id: 'portrait.flame', slot: 'portrait', name: 'Chama', description: 'Retrato da chama eterna.', price: 80, free: false, source: 'shop', presentation: { emblem: 'flame', background: '#5c1a10' } }),
  c({ id: 'portrait.tree', slot: 'portrait', name: 'Árvore antiga', description: 'Retrato da árvore antiga.', price: 80, free: false, source: 'shop', presentation: { emblem: 'tree', background: '#1f4022' } }),

  // --- Molduras do retrato ---------------------------------------------------------------
  c({ id: 'frame.none', slot: 'frame', name: 'Simples', description: 'Moldura simples.', price: null, free: true, source: 'base', presentation: { border: '#495057' } }),
  c({ id: 'frame.silver', slot: 'frame', name: 'Prata', description: 'Moldura de prata.', price: 60, free: false, source: 'shop', presentation: { border: '#ced4da' } }),
  c({ id: 'frame.gold', slot: 'frame', name: 'Ouro do vencedor', description: 'Recompensa de "Obter a primeira vitória".', price: null, free: false, source: 'mission', presentation: { border: '#ffc93c' } }),

  // --- Variação visual de equipamento (aura sob o personagem) ---------------------------------
  c({ id: 'aura.none', slot: 'aura', name: 'Cor da equipe', description: 'Anel na cor da equipe.', price: null, free: true, source: 'base', presentation: {} }),
  c({ id: 'aura.arcane', slot: 'aura', name: 'Arcana', description: 'Anel violeta luminoso.', price: 120, free: false, source: 'shop', presentation: { ring: '#b197fc' } }),
  c({ id: 'aura.ember', slot: 'aura', name: 'Brasas', description: 'Anel de brasas. Recompensa de "Incendiar dois barris".', price: null, free: false, source: 'mission', presentation: { ring: '#ff7a1a' } }),
];

export const cosmeticsById: Record<string, CosmeticDefinition> = Object.fromEntries(cosmetics.map((x) => [x.id, x]));

/** Aparência equipada: um cosmético por espaço. */
export type Appearance = Record<CosmeticSlot, string>;

export const DEFAULT_APPEARANCE: Appearance = {
  color: 'color.natural',
  outfit: 'outfit.standard',
  portrait: 'portrait.class',
  frame: 'frame.none',
  aura: 'aura.none',
};

/** Produtos da loja (cosméticos com preço). */
export const shopProducts = (): CosmeticDefinition[] => cosmetics.filter((x) => x.price !== null);

/** O jogador pode usar o cosmético (gratuito ou no inventário). */
export const canUseCosmetic = (id: string, owned: ReadonlySet<string> | readonly string[]): boolean => {
  const def = cosmeticsById[id];
  if (!def) return false;
  if (def.free) return true;
  return Array.isArray(owned) ? owned.includes(id) : (owned as ReadonlySet<string>).has(id);
};

/**
 * Corrige uma aparência vinda da rede: cada espaço com um cosmético existente daquele espaço
 * e utilizável pelo jogador (`owned`); o resto volta ao padrão.
 */
export function normalizeAppearance(raw: unknown, owned: ReadonlySet<string> | readonly string[] = []): Appearance {
  const out: Appearance = { ...DEFAULT_APPEARANCE };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const slot of COSMETIC_SLOTS) {
    const id = r[slot];
    if (typeof id === 'string' && cosmeticsById[id]?.slot === slot && canUseCosmetic(id, owned)) out[slot] = id;
  }
  return out;
}

/** Erros de equipar: o primeiro problema de uma aparência pedida (ou null se tudo ok). */
export function appearanceProblem(raw: unknown, owned: ReadonlySet<string> | readonly string[]): string | null {
  if (typeof raw !== 'object' || raw === null) return 'Aparência inválida';
  for (const [slot, id] of Object.entries(raw as Record<string, unknown>)) {
    if (!COSMETIC_SLOTS.includes(slot as CosmeticSlot)) return `Espaço desconhecido: ${slot}`;
    if (typeof id !== 'string' || cosmeticsById[id]?.slot !== slot) return `Cosmético inválido para ${slot}`;
    if (!canUseCosmetic(id, owned)) return `Você não possui ${cosmeticsById[id]!.name}`;
  }
  return null;
}
