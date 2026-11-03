/**
 * Executa todos os cenários em tests/scenarios/<categoria>/<nome>/
 * (initial.json + commands.json + expected.json) e compara estado e eventos.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import { checkExpectations, runScenario, type Command, type ScenarioExpected, type ScenarioInitial } from '@bardurinho/domain';

const root = fileURLToPath(new URL('.', import.meta.url));

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

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('cenários', () => {
  for (const dir of findScenarioDirs(root)) {
    const name = relative(root, dir).replaceAll('\\', '/');
    it(name, () => {
      const initial = readJson<ScenarioInitial>(join(dir, 'initial.json'));
      const commands = existsSync(join(dir, 'commands.json')) ? readJson<Command[]>(join(dir, 'commands.json')) : [];
      const expected = readJson<ScenarioExpected>(join(dir, 'expected.json'));
      const run = runScenario(catalog, initial, commands, { allowDebugCommands: true });
      expect(checkExpectations(run, expected)).toEqual([]);
    });
  }
});
