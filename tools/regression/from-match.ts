/**
 * Fase 6: partida do servidor → cenário de regressão em tests/scenarios (aparece no Combat
 * Debug Lab e roda no `npm test`).
 *
 *   npm run regression:from-match -- --server http://127.0.0.1:2567 --match <matchId> [--name regressao/minha_falha] [--until <versão>]
 *   npm run regression:from-match -- --file partida-1234abcd.bug.json [--name …]
 *   npm run regression:from-match -- --data .data/pg --match <matchId>      (servidor parado: lê o PGlite)
 *
 * O expected.json gerado descreve o comportamento **atual** (o replay). Para um bug, edite-o com o
 * comportamento correto: o teste falha até a correção. `--until` corta a partida numa versão
 * (útil para parar logo depois do comando problemático).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@bardurinho/content';
import { isBugReport, type BugReport } from '@bardurinho/protocol';
import { bugReportToScenario } from '../../apps/combat-debug-lab/src/regression.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[++i]! : '1');
}
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

async function load(): Promise<BugReport> {
  if (args.has('file')) {
    const data = JSON.parse(readFileSync(args.get('file')!, 'utf8'));
    return isBugReport(data) ? data : fail('O arquivo não é um relatório de bug (format bardurinho.bug-report/1)');
  }
  const match = args.get('match') ?? fail('Informe --match <id> (com --server ou --data) ou --file <relatório>');
  if (args.has('data')) {
    const { openDatabase } = await import('../../apps/server/src/db/database.js');
    const { MatchesRepository } = await import('../../apps/server/src/db/repositories.js');
    const { buildBugReport } = await import('../../apps/server/src/modules/matches/bugReport.js');
    const db = await openDatabase({ dataDir: args.get('data')! });
    try {
      return (await buildBugReport(new MatchesRepository(db), match)) ?? fail(`Partida ${match} não encontrada em ${args.get('data')}`);
    } finally {
      await db.close();
    }
  }
  const server = args.get('server') ?? 'http://127.0.0.1:2567';
  const res = await fetch(`${server}/debug/matches/${encodeURIComponent(match)}/export`);
  if (!res.ok) fail(`${server}: ${res.status} ${await res.text()} (o servidor precisa estar em modo dev)`);
  return (await res.json()) as BugReport;
}

const report = await load();
const name = args.get('name') ?? `regression/partida_${report.matchId.slice(0, 8)}`;
const until = args.has('until') ? Number(args.get('until')) : undefined;
const sc = bugReportToScenario(catalog, report, { name, ...(until !== undefined ? { untilVersion: until } : {}) });
const dir = join(args.get('out') ?? 'tests/scenarios', ...name.split('/'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'initial.json'), JSON.stringify(sc.initial, null, 2) + '\n');
writeFileSync(join(dir, 'commands.json'), JSON.stringify(sc.commands, null, 2) + '\n');
writeFileSync(join(dir, 'expected.json'), JSON.stringify(sc.expected, null, 2) + '\n');
console.log(`cenário: ${dir}`);
console.log(`  ${sc.commands.length} comandos (até a versão ${until ?? report.final.version} de ${report.final.version}); ${report.rejected.length} recusados no relatório (fora do replay)`);
console.log(`  snapshot 0 reconstruído ${sc.check.initialMatches ? 'idêntico' : 'DIFERENTE'} ao do servidor; replay ${sc.check.errors} recusados; hash ${sc.check.replayHash}${sc.check.serverHash ? (sc.check.serverHash === sc.check.replayHash ? ' = servidor' : ` ≠ servidor ${sc.check.serverHash}`) : ''}`);
console.log(sc.check.identical ? 'OK — reproduz a partida do servidor. Edite expected.json com o comportamento correto se for um bug.' : 'ATENÇÃO: o replay não reproduz o servidor (regras/conteúdo mudaram desde a partida?)');
process.exit(sc.check.identical ? 0 : 2);
