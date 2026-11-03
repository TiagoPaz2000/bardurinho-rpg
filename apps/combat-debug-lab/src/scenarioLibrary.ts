/**
 * Biblioteca de cenários (Fase 4): os mesmos cenários de tests/scenarios (initial.json +
 * commands.json + expected.json) carregados no laboratório. Ao abrir um cenário, a timeline
 * recebe os comandos dele (STEP/REPLAY/inspeção funcionam) e o resultado é conferido com
 * o expected.json pela mesma função dos testes automatizados (`checkExpectations`).
 *
 * `?scenario=<categoria>/<nome>` abre um cenário ao carregar a página; `window.__lab`
 * expõe a lista e `runAll()` (verificação automática no navegador — tools/e2e/conteudo.mjs).
 */
import { checkExpectations, runScenario, type Catalog, type Command, type ScenarioExpected, type ScenarioInitial } from '@bardurinho/domain';
import { LabSession } from './session.js';

export interface LibraryScenario {
  /** `<categoria>/<nome>` (pasta em tests/scenarios). */
  id: string;
  category: string;
  name: string;
  description: string;
  initial: ScenarioInitial;
  commands: Command[];
  expected: ScenarioExpected;
}

const files = import.meta.glob('../../../tests/scenarios/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function collect(): LibraryScenario[] {
  const byDir = new Map<string, Partial<Record<'initial' | 'commands' | 'expected', unknown>>>();
  for (const [path, data] of Object.entries(files)) {
    const m = /tests\/scenarios\/(.+)\/(initial|commands|expected)\.json$/.exec(path);
    if (!m) continue;
    const entry = byDir.get(m[1]!) ?? {};
    entry[m[2] as 'initial' | 'commands' | 'expected'] = data;
    byDir.set(m[1]!, entry);
  }
  const out: LibraryScenario[] = [];
  for (const [id, f] of byDir) {
    if (!f.initial || !f.expected) continue;
    const initial = f.initial as ScenarioInitial;
    out.push({
      id,
      category: id.split('/')[0] ?? '',
      name: initial.name ?? id,
      description: initial.description ?? '',
      initial,
      commands: (f.commands as Command[] | undefined) ?? [],
      expected: f.expected as ScenarioExpected,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const scenarioLibrary: LibraryScenario[] = collect();

/** Confere o cenário como os testes automatizados (motor com comandos de debug liberados). */
export function checkScenario(catalog: Catalog, s: LibraryScenario): string[] {
  try {
    const run = runScenario(catalog, s.initial, s.commands, { allowDebugCommands: true });
    return checkExpectations(run, s.expected);
  } catch (err) {
    return [String(err)];
  }
}

/**
 * Sessão do laboratório com o cenário aplicado comando a comando (os recusados ficam fora da
 * timeline, como no teste). Devolve também o resultado da conferência.
 */
export function openScenario(catalog: Catalog, s: LibraryScenario): { session: LabSession; failures: string[]; rejected: number } {
  const session = new LabSession(catalog, s.initial);
  let rejected = 0;
  for (const c of s.commands) if (!session.execute(c, {})) rejected++;
  return { session, failures: checkScenario(catalog, s), rejected };
}
