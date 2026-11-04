import type { Catalog, DefinitionBase, SurfaceDefinition, SurfaceKind } from '@bardurinho/domain';
import { abilities } from './abilities/index.js';
import { classes } from './classes/index.js';
import { items } from './items/index.js';
import { dummies, objects } from './objects/index.js';
import { statuses, surfaces } from './statuses/index.js';

/** Versão do pacote de conteúdo. Cada partida registra a versão usada (princípio 7). */
export const CONTENT_VERSION = '0.1.0';

const byId = <T extends DefinitionBase>(list: T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const def of list) {
    if (out[def.id]) throw new Error(`ID de conteúdo duplicado: ${def.id}`);
    out[def.id] = def;
  }
  return out;
};

export function buildCatalog(): Catalog {
  return {
    contentVersion: CONTENT_VERSION,
    classes: byId(classes),
    abilities: byId(abilities),
    items: byId(items),
    statuses: byId(statuses),
    surfaces: Object.fromEntries(surfaces.map((s) => [s.surface, s])) as Record<SurfaceKind, SurfaceDefinition>,
    objects: byId(objects),
    dummies: byId(dummies),
  };
}

export const catalog: Catalog = buildCatalog();

export { abilities, classes, items, statuses, surfaces, objects, dummies };
export { validateCatalog, type ValidationIssue } from './validate.js';
export { maps, patioDasRuinas, type MapDefinition } from './maps/index.js';
export * from './maps/setup.js';
export { describeDefinition, describeEffect, describeStatus, describeTarget, formatAmount, formatCost, BASIC_ACTION_DESCRIPTIONS, type Description } from './describe.js';
export * from './progression/cosmetics.js';
export * from './progression/progression.js';
