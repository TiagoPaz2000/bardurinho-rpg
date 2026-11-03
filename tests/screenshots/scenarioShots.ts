/**
 * Gera screenshots de um cenário JSON (tests/scenarios/<categoria>/<nome>/):
 *   before.png               estado inicial (após START_MATCH, se autoStart)
 *   after_command_<n>.png    após cada comando aceito (n = posição 1-based em commands.json)
 *   final.png                estado final
 * em tests/output/<categoria>/<nome>/, junto de um manifest.json usado pela galeria (index.html).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, buildScenario, type Catalog, type Command, type GameState, type ScenarioInitial } from '@bardurinho/domain';
import { renderStateToPng } from './screenshot.js';

export const SCENARIOS_ROOT = fileURLToPath(new URL('../scenarios/', import.meta.url));
export const OUTPUT_ROOT = fileURLToPath(new URL('../output/', import.meta.url));

export interface ShotEntry {
  file: string;
  label: string;
  round: number;
}

export interface ScenarioManifest {
  /** Caminho relativo do cenário, ex.: "surfaces/oil_ignition". */
  scenario: string;
  title: string | null;
  description: string | null;
  shots: ShotEntry[];
  /** Comandos rejeitados (sem screenshot próprio). */
  rejected: Array<{ command: number; type: string; code: string; message: string }>;
}

export function findScenarioDirs(dir: string = SCENARIOS_ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, 'initial.json'))) out.push(full);
    else out.push(...findScenarioDirs(full));
  }
  return out.sort();
}

export const scenarioName = (dir: string): string => relative(SCENARIOS_ROOT, dir).replaceAll('\\', '/');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export function generateScenarioScreenshots(catalog: Catalog, dir: string, outputRoot: string = OUTPUT_ROOT): ScenarioManifest {
  const name = scenarioName(dir);
  const initial = readJson<ScenarioInitial>(join(dir, 'initial.json'));
  const commands = existsSync(join(dir, 'commands.json')) ? readJson<Command[]>(join(dir, 'commands.json')) : [];
  const outDir = join(outputRoot, ...name.split('/'));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const manifest: ScenarioManifest = {
    scenario: name,
    title: initial.name ?? null,
    description: initial.description ?? null,
    shots: [],
    rejected: [],
  };
  const shoot = (state: GameState, file: string, label: string) => {
    const round = state.turn.round;
    const caption = `${name} · ${label} · rodada ${round}`;
    writeFileSync(join(outDir, file), renderStateToPng(state, catalog, { caption }));
    manifest.shots.push({ file, label, round });
  };

  let state = buildScenario(catalog, initial);
  shoot(state, 'before.png', 'before');
  commands.forEach((command, i) => {
    const r = applyCommand(state, catalog, command, { allowDebugCommands: true });
    if (!r.ok) {
      manifest.rejected.push({ command: i + 1, type: command.type, code: r.error.code, message: r.error.message });
      return;
    }
    state = r.state;
    shoot(state, `after_command_${i + 1}.png`, `after_command_${i + 1} (${command.type})`);
  });
  shoot(state, 'final.png', 'final');
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function findManifests(dir: string): ScenarioManifest[] {
  if (!existsSync(dir)) return [];
  const out: ScenarioManifest[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findManifests(full));
    else if (name === 'manifest.json') out.push(readJson<ScenarioManifest>(full));
  }
  return out;
}

/** Escreve tests/output/index.html com todos os cenários que têm manifest.json. */
export function writeGallery(outputRoot: string = OUTPUT_ROOT): string {
  const manifests = findManifests(outputRoot).sort((a, b) => a.scenario.localeCompare(b.scenario));
  const sections = manifests
    .map((m) => {
      const shots = m.shots
        .map(
          (s) =>
            `<figure><a href="${esc(m.scenario)}/${esc(s.file)}"><img src="${esc(m.scenario)}/${esc(s.file)}" alt="${esc(s.label)}"></a>` +
            `<figcaption>${esc(s.label)} · rodada ${s.round}</figcaption></figure>`,
        )
        .join('\n');
      const rejected = m.rejected.length
        ? `<p class="rej">Comandos rejeitados: ${m.rejected.map((r) => esc(`#${r.command} ${r.type}: ${r.code}`)).join('; ')}</p>`
        : '';
      return (
        `<section id="${esc(m.scenario)}"><h2>${esc(m.scenario)}</h2>` +
        (m.title ? `<p class="title">${esc(m.title)}</p>` : '') +
        (m.description ? `<p>${esc(m.description)}</p>` : '') +
        rejected +
        `<div class="shots">${shots}</div></section>`
      );
    })
    .join('\n');
  const toc = manifests.map((m) => `<li><a href="#${esc(m.scenario)}">${esc(m.scenario)}</a></li>`).join('');
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Screenshots dos cenários</title>
<style>
body { background: #1a1b1e; color: #e9ecef; font-family: system-ui, sans-serif; margin: 24px; }
a { color: #74c0fc; }
section { margin: 32px 0; border-top: 1px solid #373a40; padding-top: 12px; }
.title { color: #ced4da; font-weight: 600; }
.rej { color: #ffa94d; }
.shots { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
figure { margin: 0; }
figure img { display: block; max-width: 420px; border: 1px solid #373a40; }
figcaption { font-size: 12px; color: #adb5bd; margin-top: 4px; }
</style>
</head>
<body>
<h1>Screenshots dos cenários</h1>
<p>Gerado em ${esc(new Date().toISOString())}. Apenas para inspeção humana: a validação é feita pelo estado (expected.json).</p>
<ul>${toc}</ul>
${sections}
</body>
</html>
`;
  const path = join(outputRoot, 'index.html');
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path, html);
  return path;
}
