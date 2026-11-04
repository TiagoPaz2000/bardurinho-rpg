import {
  CELL_SELECTORS,
  EFFECT_OP_NAMES,
  isValidDice,
  ENTITY_SELECTORS,
  type Catalog,
  type EffectOp,
} from '@bardurinho/domain';

export interface ValidationIssue {
  definitionId: string;
  message: string;
}

const CELL_OPS = new Set(['createSurface', 'removeSurface', 'emitStimulus']);

/** Validação de referências e formato do catálogo (tools/validate-content). */
export function validateCatalog(catalog: Catalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (definitionId: string, message: string) => issues.push({ definitionId, message });

  const checkEffects = (ownerId: string, effects: EffectOp[]) => {
    effects.forEach((op, i) => {
      if (!EFFECT_OP_NAMES.includes(op.op)) issue(ownerId, `efeito #${i}: operação desconhecida '${op.op}'`);
      const validSelectors: readonly string[] = CELL_OPS.has(op.op) ? CELL_SELECTORS : ENTITY_SELECTORS;
      if ('selector' in op && !validSelectors.includes(op.selector)) issue(ownerId, `efeito #${i}: seletor '${op.selector}' inválido para ${op.op}`);
      if (op.op === 'dashToTarget' && op.maxCost <= 0) issue(ownerId, `efeito #${i}: maxCost precisa ser > 0`);
      if ((op.op === 'applyStatus' || op.op === 'removeStatus') && !catalog.statuses[op.statusId]) {
        issue(ownerId, `efeito #${i}: estado inexistente '${op.statusId}'`);
      }
      if (op.op === 'createSurface' && !catalog.surfaces[op.surface]) {
        issue(ownerId, `efeito #${i}: superfície inexistente '${op.surface}'`);
      }
      if (op.op === 'damage' && op.save && (op.save.dc < 2 || op.save.dc > 20)) issue(ownerId, `efeito #${i}: CD do teste precisa estar entre 2 e 20`);
      if ('amount' in op && (typeof op.amount === 'number' ? op.amount < 0 : !isValidDice(op.amount))) {
        issue(ownerId, `efeito #${i}: valor ou fórmula de dados inválida (${String(op.amount)})`);
      }
    });
  };

  for (const cls of Object.values(catalog.classes)) {
    for (const w of cls.loadout.weapons) {
      const item = catalog.items[w];
      if (item?.kind !== 'weapon') issue(cls.id, `arma inexistente '${w}'`);
      else if (!item.classIds.includes(cls.id)) issue(cls.id, `arma '${w}' não permitida para a classe`);
    }
    const armor = catalog.items[cls.loadout.armor];
    if (armor?.kind !== 'armor') issue(cls.id, `armadura inexistente '${cls.loadout.armor}'`);
    else if (!armor.classIds.includes(cls.id)) issue(cls.id, `armadura não permitida para a classe`);
    for (const a of cls.loadout.abilities) {
      const ability = catalog.abilities[a];
      if (!ability) issue(cls.id, `habilidade inexistente '${a}'`);
      else if (ability.classId !== cls.id) issue(cls.id, `habilidade '${a}' pertence a '${ability.classId}'`);
    }
  }

  for (const ability of Object.values(catalog.abilities)) {
    if (!catalog.classes[ability.classId]) issue(ability.id, `classe inexistente '${ability.classId}'`);
    if (ability.version < 1) issue(ability.id, 'versão precisa ser ≥ 1');
    if (ability.maxUsesPerTurn < 1) issue(ability.id, 'maxUsesPerTurn precisa ser ≥ 1');
    if (ability.target.kind !== 'self' && ability.target.range === undefined) issue(ability.id, 'alvo sem alcance');
    if (ability.requiresWeaponTag && !Object.values(catalog.items).some((i) => i.kind === 'weapon' && i.tags.includes(ability.requiresWeaponTag!))) {
      issue(ability.id, `nenhuma arma possui a tag '${ability.requiresWeaponTag}'`);
    }
    if (ability.effects.length === 0) issue(ability.id, 'habilidade sem efeitos');
    checkEffects(ability.id, ability.effects);
  }

  for (const item of Object.values(catalog.items)) {
    if (item.kind === 'consumable') checkEffects(item.id, item.effects);
    if (item.kind === 'weapon' && !isValidDice(item.damage)) issue(item.id, `fórmula de dano inválida: ${item.damage}`);
    if ((item.kind === 'weapon' || item.kind === 'armor') && item.classIds.some((c) => !catalog.classes[c])) {
      issue(item.id, 'classe inexistente em classIds');
    }
  }

  for (const obj of Object.values(catalog.objects)) {
    if (obj.interaction?.kind === 'grantConsumable' && catalog.items[obj.interaction.itemId]?.kind !== 'consumable') {
      issue(obj.id, `consumível inexistente '${obj.interaction.itemId}'`);
    }
  }

  return issues;
}
