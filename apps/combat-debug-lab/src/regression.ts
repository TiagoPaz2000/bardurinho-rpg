/**
 * Fase 6: relatório de bug de uma partida (`GET /debug/matches/:id/export` do servidor) →
 * cenário de regressão (initial.json + commands.json + expected.json de tests/scenarios).
 * Puro (sem DOM): usado pelo Lab ("Importar"), pela ferramenta `npm run regression:from-match` e
 * pelos testes.
 *
 * - `initial` = snapshot 0 oficial exportado como cenário (`exportScenario`) com dados aleatórios
 *   e a semente da partida, sem início automático (o START_MATCH é o primeiro comando);
 * - `commands` = comandos aceitos na ordem (jogadores, cronômetro, servidor), até `untilVersion`;
 * - `expected` = estado obtido no replay (`snapshotExpected`, sem a lista de eventos): é o
 *   comportamento **atual**. Para um bug, edite o expected.json com o comportamento correto — o
 *   teste falha até a correção.
 * O replay confere o hash com o do servidor (mesma partida, mesmo estado).
 */
import { buildScenario, exportScenario, runScenario, snapshotExpected, type Catalog, type Command, type ScenarioExpected, type ScenarioInitial } from '@bardurinho/domain';
import { stateHash, type BugReport } from '@bardurinho/protocol';

export interface RegressionScenario {
  initial: ScenarioInitial;
  commands: Command[];
  expected: ScenarioExpected;
  check: {
    /** O snapshot 0 reconstruído a partir do cenário tem o mesmo hash do servidor. */
    initialMatches: boolean;
    /** Hash do estado no fim do replay e o do servidor na mesma versão (se conhecido). */
    replayHash: string;
    serverHash: string | null;
    identical: boolean;
    errors: number;
  };
}

export function bugReportToScenario(catalog: Catalog, report: BugReport, opts: { name?: string; untilVersion?: number } = {}): RegressionScenario {
  const s0 = report.initial.state;
  const base = exportScenario(s0, opts.name ?? `Partida ${report.matchId.slice(0, 8)}`);
  // Nome de exibição do personagem (entra no hash do estado) e início manual.
  const names = new Map(Object.values(s0.units).map((u) => [u.id, u.name]));
  const initial: ScenarioInitial = {
    ...base,
    description: `Reproduz a partida ${report.matchId} (semente ${report.seed}, ${report.commands.length} comandos aceitos, status ${report.status}). Gerado de um relatório de bug do servidor.`,
    units: (base.units ?? []).map((u) => ('classId' in u ? { ...u, name: names.get(u.id) ?? u.classId } : u)),
    autoStart: false,
  };
  const until = opts.untilVersion ?? report.final.version;
  const commands = report.commands.filter((c) => c.versionAfter <= until).map((c) => c.command as Command);
  const initialMatches = stateHash(buildScenario(catalog, initial)) === report.initial.hash;
  const run = runScenario(catalog, initial, commands, {});
  const { events: _events, ...expected } = snapshotExpected(run.state, run.events);
  const replayHash = stateHash(run.state);
  const serverHash = until === report.final.version ? report.final.hash : null;
  return {
    initial,
    commands,
    expected: { ...expected, errors: run.errors.length, ...(run.state.result ? { result: run.state.result } : {}) },
    check: { initialMatches, replayHash, serverHash, identical: initialMatches && run.errors.length === 0 && (serverHash === null || serverHash === replayHash), errors: run.errors.length },
  };
}
