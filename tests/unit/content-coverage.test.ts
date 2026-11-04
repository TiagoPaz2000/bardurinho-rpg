/**
 * Fase 4 — verificação de conteúdo: todo conteúdo do MVP (habilidades, os 14 itens,
 * estados, superfícies e objetos) precisa aparecer em pelo menos um cenário JSON
 * de tests/scenarios (os mesmos cenários que o Combat Debug Lab importa).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import type { ScenarioInitial } from '@bardurinho/domain';

const scenariosRoot = fileURLToPath(new URL('../scenarios/', import.meta.url));

interface ScenarioFiles {
  name: string;
  initial: string;
  commands: string;
  expected: string;
  initialJson: ScenarioInitial;
}

function findScenarioDirs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, 'initial.json'))) out.push(full);
    else out.push(...findScenarioDirs(full));
  }
  return out.sort();
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const scenarios: ScenarioFiles[] = findScenarioDirs(scenariosRoot).map((dir) => {
  const initial = read(join(dir, 'initial.json'));
  return {
    name: relative(scenariosRoot, dir).replaceAll('\\', '/'),
    initial,
    commands: read(join(dir, 'commands.json')),
    expected: read(join(dir, 'expected.json')),
    initialJson: JSON.parse(initial) as ScenarioInitial,
  };
});

const quoted = (id: string) => `"${id}"`;
const mentions = (text: string, id: string) => text.includes(quoted(id));
const inSetup = (s: ScenarioFiles, id: string) => mentions(s.initial, id) || mentions(s.commands, id);

/** Retorna os ids sem nenhum cenário, para a mensagem de erro listar o que falta. */
const missing = (ids: string[], covered: (id: string) => boolean): string[] => ids.filter((id) => !covered(id));

describe('cobertura de conteúdo por cenários (Fase 4)', () => {
  it('há cenários suficientes para verificar', () => {
    expect(scenarios.length).toBeGreaterThan(40);
  });

  it('todo cenário tem nome e descrição em initial.json', () => {
    const without = scenarios.filter((s) => !s.initialJson.name || !s.initialJson.description).map((s) => s.name);
    // Os 5 cenários da Fase 1 têm só nome; os novos têm nome e descrição.
    const legacy = ['combat/sword_vs_armor_and_barrier', 'explosions/barrel_chain', 'movement/rooted_blocks_move', 'spells/mage_flame_vs_fire_resistance', 'surfaces/oil_ignition'];
    expect(without.filter((n) => !legacy.includes(n)), 'cenários sem name/description').toEqual([]);
  });

  it('as 11 habilidades são usadas em cenários', () => {
    const ids = Object.keys(catalog.abilities);
    expect(ids).toHaveLength(11);
    expect(missing(ids, (id) => scenarios.some((s) => inSetup(s, id))), 'habilidades sem cenário').toEqual([]);
  });

  it('os 14 itens aparecem em cenários (armaduras: classe que as veste ou id na descrição)', () => {
    const ids = Object.keys(catalog.items);
    expect(ids).toHaveLength(14);
    const covered = (id: string) => {
      const item = catalog.items[id]!;
      if (item.kind !== 'armor') return scenarios.some((s) => inSetup(s, id));
      const wearers = Object.values(catalog.classes).filter((c) => c.loadout.armor === id).map((c) => c.id);
      return scenarios.some(
        (s) => (s.initialJson.description ?? '').includes(id) || (s.initialJson.units ?? []).some((u) => 'classId' in u && wearers.includes(u.classId)),
      );
    };
    expect(missing(ids, covered), 'itens sem cenário').toEqual([]);
  });

  it('todas as armaduras têm um cenário dedicado (id na descrição)', () => {
    const armors = Object.values(catalog.items).filter((i) => i.kind === 'armor').map((i) => i.id);
    expect(armors).toHaveLength(3);
    expect(missing(armors, (id) => scenarios.some((s) => (s.initialJson.description ?? '').includes(id))), 'armaduras sem cenário').toEqual([]);
  });

  it('todos os estados aparecem em cenários (comandos ou estado esperado)', () => {
    const ids = Object.keys(catalog.statuses);
    expect(missing(ids, (id) => scenarios.some((s) => inSetup(s, id) || mentions(s.expected, id))), 'estados sem cenário').toEqual([]);
  });

  it('todas as superfícies aparecem em cenários', () => {
    const kinds = Object.keys(catalog.surfaces);
    expect(kinds.sort()).toEqual(['fire', 'oil', 'thorns']);
    const re = (kind: string) => new RegExp(`"surface":\\s*"${kind}"`);
    expect(missing(kinds, (k) => scenarios.some((s) => re(k).test(s.initial) || re(k).test(s.commands) || re(k).test(s.expected))), 'superfícies sem cenário').toEqual([]);
  });

  it('todos os objetos do mapa aparecem em cenários', () => {
    const ids = Object.keys(catalog.objects);
    expect(ids).toHaveLength(8);
    const covered = (id: string) => scenarios.some((s) => (s.initialJson.objects ?? []).some((o) => o.defId === id));
    expect(missing(ids, covered), 'objetos sem cenário').toEqual([]);
  });

  it('todas as classes aparecem em cenários', () => {
    const ids = Object.keys(catalog.classes);
    const covered = (id: string) => scenarios.some((s) => (s.initialJson.units ?? []).some((u) => 'classId' in u && u.classId === id));
    expect(missing(ids, covered), 'classes sem cenário').toEqual([]);
  });
});
