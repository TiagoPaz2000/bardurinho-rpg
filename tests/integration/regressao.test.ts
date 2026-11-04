/**
 * Fase 6 — relatório de bug → cenário de regressão: uma partida do servidor (bot × bot, dados
 * aleatórios, cronômetro e servidor como autores) exportada pelo mesmo código da rota
 * `/debug/matches/:id/export` vira initial/commands/expected que o runner de tests/scenarios e o
 * Combat Debug Lab reproduzem com o mesmo hash do servidor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '@bardurinho/content';
import { checkExpectations, runScenario } from '@bardurinho/domain';
import { buildBugReport } from '../../apps/server/src/modules/matches/bugReport.js';
import { bugReportToScenario } from '../../apps/combat-debug-lab/src/regression.js';
import { LabSession } from '../../apps/combat-debug-lab/src/session.js';
import { openHarness, startSession, type Harness } from './support/matchHarness.js';
import { stateHash } from '@bardurinho/protocol';

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
}, 60_000);
afterAll(async () => {
  await h?.close();
});

describe('Fase 6 — partida do servidor → teste de regressão', () => {
  it('o relatório reproduz a partida inteira no core e no Lab (mesmo hash); --until corta numa versão', async () => {
    const run = await startSession(h, { seed: 2024, classes: ['druid', 'rogue'], bots: ['normal', 'easy'] });
    const t0 = Date.now();
    while (run.session.state.status !== 'finished' && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 20));
    await run.session.idle();
    // Um comando do cronômetro também entra no registro (autor "timer").
    const report = (await buildBugReport(h.matches, run.session.id))!;
    expect(report.format).toBe('bardurinho.bug-report/1');
    expect(report.commands[0]!.command.type).toBe('START_MATCH');
    expect(report.initial.state.rng.seed).toBe(2024);

    const sc = bugReportToScenario(catalog, report, { name: 'regression/teste' });
    expect(sc.check).toMatchObject({ initialMatches: true, errors: 0, identical: true });
    expect(sc.check.replayHash).toBe(report.final.hash);
    // Mesmo caminho do runner de tests/scenarios (JSON de ida e volta).
    const initial = JSON.parse(JSON.stringify(sc.initial));
    const commands = JSON.parse(JSON.stringify(sc.commands));
    const rerun = runScenario(catalog, initial, commands, { allowDebugCommands: true });
    expect(checkExpectations(rerun, sc.expected)).toEqual([]);
    expect(stateHash(rerun.state)).toBe(report.final.hash);
    // No Lab: a timeline recebe os comandos e o REPLAY confirma o determinismo.
    const lab = new LabSession(catalog, initial);
    for (const c of commands) if (c.type !== 'START_MATCH') expect(lab.execute(c, {})).toBe(true);
    expect(stateHash(lab.state)).toBe(report.final.hash);
    expect(lab.replay().identical).toBe(true);

    // Cortar numa versão do meio: o estado bate com o snapshot do servidor daquela versão.
    const mid = Math.floor(report.final.version / 2);
    const cut = bugReportToScenario(catalog, report, { untilVersion: mid });
    expect(cut.commands).toHaveLength(mid);
    expect(cut.check.replayHash).toBe((await h.matches.snapshot(run.session.id, mid))!.hash);
    for (const b of run.bots) b.dispose();
    run.session.dispose();
  }, 60_000);
});
