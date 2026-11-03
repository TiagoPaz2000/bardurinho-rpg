import type { StatusDefinition, SurfaceDefinition } from '@bardurinho/domain';

/** Estados aplicados aos personagens (seção 5.1). A Barreira é modelada como `Unit.shield`. */
export const statuses: StatusDefinition[] = [
  {
    kind: 'status', id: 'burning', version: 1, name: 'Queimando', tags: ['FIRE', 'DOT'],
    duration: { kind: 'targetTurnStarts', count: 2 },
    tickDamage: { amount: 4, damageType: 'fire' },
    stacking: 'refresh',
    presentation: { iconId: 'icon.status.burning', vfxId: 'fire.continuous' },
  },
  {
    kind: 'status', id: 'slowed', version: 1, name: 'Lentidão', tags: ['COLD', 'CONTROL'],
    duration: { kind: 'targetTurns', count: 1 },
    modifiers: { mp: -2 },
    stacking: 'refresh',
    presentation: { iconId: 'icon.status.slowed' },
  },
  {
    kind: 'status', id: 'rooted', version: 1, name: 'Enraizado', tags: ['NATURE', 'CONTROL'],
    duration: { kind: 'targetTurns', count: 1 },
    flags: ['rooted'],
    stacking: 'refresh',
    presentation: { iconId: 'icon.status.rooted', vfxId: 'status.roots' },
  },
  {
    kind: 'status', id: 'hidden', version: 1, name: 'Oculto', tags: ['STEALTH'],
    // Termina ao final do próximo turno próprio (também ao atacar, receber dano ou ser revelado).
    duration: { kind: 'targetTurns', count: 1 },
    flags: ['hidden'],
    stacking: 'refresh',
    presentation: { iconId: 'icon.status.hidden', vfxId: 'stealth.transition' },
  },
];

/** Superfícies (seção 5.2). */
export const surfaces: SurfaceDefinition[] = [
  { kind: 'surface', id: 'surface.oil', version: 1, name: 'Óleo', tags: ['OIL', 'FLAMMABLE'], surface: 'oil', enterCost: 2 },
  {
    kind: 'surface', id: 'surface.fire', version: 1, name: 'Fogo', tags: ['FIRE'], surface: 'fire', enterCost: 1,
    exposureDamage: { amount: 6, damageType: 'fire' },
  },
  {
    kind: 'surface', id: 'surface.thorns', version: 1, name: 'Espinhos', tags: ['NATURE', 'FLAMMABLE'], surface: 'thorns', enterCost: 2,
    exposureDamage: { amount: 5, damageType: 'physical' },
  },
];
