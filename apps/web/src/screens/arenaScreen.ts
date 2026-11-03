/**
 * Tela da arena (Fase 2): monta a cena 3D a partir do core e liga câmera, HUD, seleção e
 * comandos. O estado oficial fica no MatchController; a cena só o lê (`ArenaView.sync`).
 *
 * Etapa 2: dados aleatórios com semente nova, seleção/picking, destaques de alcance e
 * caminho, movimento animado e encerrar turno — partida local controlando os dois lados.
 * Etapa 3: barra de ações (1–9), modo de habilidade (mira com área e chance de acerto),
 * dados na tela, barras sobre os personagens, iniciativa, câmera automática mínima
 * (CameraEventQueue) e tela de fim de partida.
 */
import { Color4, Engine, Matrix, Scene, Vector3 } from '@babylonjs/core';
import { buildScenario, coordKey, reachableCells, type ActionInfo, type Catalog, type Coord, type GameState, type GameplayCommand } from '@bardurinho/domain';
import type { MapDefinition } from '@bardurinho/content';
import { MatchController } from '../game/MatchController.js';
import { TacticalInteraction } from '../game/TacticalInteraction.js';
import { ArenaView } from '../rendering/ArenaView.js';
import { CameraBounds, CameraController, CameraEventQueue, CameraFocus, CameraInput, CameraOcclusion, FOCUS_RADIUS } from '../rendering/camera/index.js';
import { pace } from '../rendering/anim.js';
import { playEvents } from '../rendering/eventPlayback.js';
import { arenaBounds, cellToWorld, floorToWorldY } from '../rendering/grid.js';
import { UnitStatusBars } from '../rendering/unitBars.js';
import { WorldLabels } from '../rendering/worldLabels.js';
import { ActionBar } from './actionBar.js';
import { Hud } from './hud.js';

const OVERVIEW_RADIUS = 46;

export interface ArenaScreen {
  engine: Engine;
  scene: Scene;
  /** Estado oficial atual (somente leitura). */
  readonly state: GameState;
  match: MatchController;
  arena: ArenaView;
  camera: CameraController;
  cameraEvents: CameraEventQueue;
  focus: CameraFocus;
  tactical: TacticalInteraction;
  actionBar: ActionBar;
  hud: Hud;
  setViewedFloor(floor: number): void;
  endTurn(): Promise<void>;
  /** Escolhe uma carta da barra de ações pela chave (ex.: `ability:mage.flame`). */
  chooseAction(key: string): void;
  /** Depuração/testes: ponto da tela (px CSS) do centro de uma célula. */
  cellToScreen(c: Coord): { x: number; y: number };
  /** Depuração/testes: células alcançáveis pelo personagem ativo, com custo. */
  reachable(): Array<{ x: number; y: number; floor: number; cost: number }>;
  ready: Promise<void>;
}

/**
 * Depuração da apresentação: `?units=druid@7,10;warrior@8,12` troca a classe (e, se dada,
 * a posição) dos personagens do cenário de exemplo, na ordem. Só muda a montagem do
 * cenário; as regras são as mesmas. Sem o parâmetro, o cenário do mapa é usado como está.
 */
export function scenarioOverride(mapDef: MapDefinition, catalog: Catalog, search = location.search): MapDefinition['scenario'] {
  const raw = new URLSearchParams(search).get('units');
  if (!raw) return mapDef.scenario;
  const specs = raw.split(';').map((entry) => {
    const [classId, at] = entry.trim().split('@');
    const [x, y, floor] = (at ?? '').split(',').map(Number);
    return { classId: classId?.trim() ?? '', pos: at ? { x: x!, y: y!, floor: floor || 0 } : null };
  });
  const units = mapDef.scenario.units?.map((u, i) => {
    const spec = specs[i];
    if (!spec || !catalog.classes[spec.classId]) return u;
    return { ...u, classId: spec.classId, id: `${spec.classId}-0${i + 1}`, ...(spec.pos ? { pos: spec.pos } : {}) };
  });
  // A ordem fixa do cenário cita os ids antigos.
  const renamed = new Map((mapDef.scenario.units ?? []).map((u, i) => [u.id, units?.[i]?.id ?? u.id]));
  const order = mapDef.scenario.order?.map((id) => renamed.get(id) ?? id);
  return { ...mapDef.scenario, units, ...(order ? { order } : {}) };
}

/** Semente dos dados: `?seed=123` na URL (reprodutível) ou aleatória. */
function matchSeed(): number {
  const fromUrl = Number(new URLSearchParams(location.search).get('seed'));
  return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : newSeed();
}
const newSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 1));

export function startArenaScreen(canvas: HTMLCanvasElement, hudRoot: HTMLElement, catalog: Catalog, mapDef: MapDefinition): ArenaScreen {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  // Sistema destro, igual ao glTF: os GLBs entram sem espelhamento (ver rendering/grid.ts).
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.08, 0.085, 0.095, 1);
  scene.ambientColor.set(0.25, 0.25, 0.25);

  // Partida real: dados aleatórios (o padrão dos cenários de teste é `average`). O cenário é
  // montado sem iniciar: o START_MATCH passa pelo MatchController para a iniciativa (d20)
  // chegar à tela como evento.
  const seed = matchSeed();
  const match = new MatchController(catalog, buildScenario(catalog, { ...scenarioOverride(mapDef, catalog), dice: 'random', seed, autoStart: false }));
  const map = match.state.map;
  const arena = new ArenaView(scene, match.state);

  const b = arenaBounds(map);
  const bounds = new CameraBounds({ ...b, margin: 4, minRadius: 10, maxRadius: 60 });
  const camera = new CameraController(scene, bounds, new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), OVERVIEW_RADIUS);
  const focus = new CameraFocus(camera);
  const cameraEvents = new CameraEventQueue();
  const occlusion = new CameraOcclusion();

  const setViewedFloor = (floor: number) => {
    arena.floorView.setViewedFloor(floor);
    camera.setFocusHeight(floorToWorldY(arena.floorView.viewedFloor));
  };
  const focusCell = (c: Coord, radius?: number) => {
    // Alvo acima do andar visualizado ficaria fantasma: sobe a visualização.
    if (c.floor > arena.floorView.viewedFloor) setViewedFloor(c.floor);
    focus.focusCell(c, radius);
  };
  const focusActive = () => {
    const unit = match.activeUnit;
    if (unit) focusCell(unit.pos, Math.min(camera.radius, FOCUS_RADIUS));
  };
  // Câmera automática (seções 14.10–14.12): tomadas pedidas pela reprodução dos eventos.
  cameraEvents.runner = (shot) => {
    const cell = shot.targetCell ?? (shot.targetEntity ? match.state.units[shot.targetEntity]?.pos : undefined);
    if (cell) focusCell(cell);
  };
  // Tremor das explosões (desligado junto com a câmera automática).
  arena.vfx.shake = (amplitude, seconds) => {
    if (cameraEvents.preference !== 'off') camera.shake(amplitude, seconds);
  };
  const toggleSpeed = () => {
    pace.setFast(!pace.fast);
    hud.setFast(pace.fast);
  };
  const input = new CameraInput(camera, canvas, { focusActive, onManualInput: () => cameraEvents.interrupt() });

  const hud = new Hud(hudRoot, catalog, {
    endTurn: () => void endTurn(),
    execute: (command) => void execute(command),
    aim: (action) => void tactical.startAiming(action),
    newMatch: () => {
      // Nova partida = recarregar com uma semente nova (reconstrói cena e estado do zero).
      const params = new URLSearchParams(location.search);
      params.set('seed', String(newSeed()));
      location.search = params.toString();
    },
    toggleSpeed: () => toggleSpeed(),
  });
  hud.setFast(pace.fast);
  const labels = new WorldLabels(scene, engine, hudRoot);
  const bars = new UnitStatusBars(arena, labels, catalog);
  const tactical = new TacticalInteraction({ scene, canvas, arena, match, catalog, labels, onManualInput: () => cameraEvents.interrupt() });
  const actionBar = new ActionBar(hudRoot, catalog, { choose: (x) => chooseAction(x) });

  match.presenter = {
    play: (evs, _before, after) =>
      playEvents(
        { scene, arena, labels, catalog, bars, camera: cameraEvents, after, onInitiative: (rolls, order) => hud.showInitiative(after, rolls, order) },
        evs,
      ),
    sync: (state) => {
      arena.sync(state);
      bars.sync(state);
    },
    rejected: (error) => hud.toast(error.message),
  };
  match.onChange(({ before, state }) => {
    // Novo turno: seleciona e enquadra o personagem da vez.
    if (state.turn.turnId !== before.turn.turnId) {
      tactical.selectUnit(state.turn.activeUnitId);
      focusActive();
      // Início da partida (seção 14.14): câmera já posicionada no personagem ativo.
      if (before.status === 'setup') camera.snap();
    } else tactical.refresh();
  });

  async function execute(command: GameplayCommand): Promise<void> {
    if (match.busy) return;
    tactical.cancelAiming();
    await match.execute({ ...command, expectedTurnId: match.state.turn.turnId });
  }

  async function endTurn(): Promise<void> {
    const unit = match.activeUnit;
    if (!unit || match.busy) return;
    await execute({ type: 'END_TURN', actorId: unit.id });
  }

  /** Carta da barra: sem alvo executa; com alvo entra no modo de habilidade; Mover volta ao tático. */
  function chooseAction(x: ActionInfo | string): void {
    const action = typeof x === 'string' ? actionBar.list.find((a) => a.key === x) : x;
    if (!action || match.busy) return;
    if (action.kind === 'move') {
      tactical.cancelAiming();
      if (!action.available) hud.toast(action.reason?.message ?? 'Movimento indisponível');
      return;
    }
    if (!action.available) {
      hud.toast(action.reason?.message ?? 'Ação indisponível');
      return;
    }
    if (action.command) void execute(action.command as GameplayCommand);
    else tactical.startAiming(action);
  }

  // Teclas da tela (não são da câmera): ações 1–9, andar visualizado, grade, visão geral, turno.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const f = arena.floorView.viewedFloor;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) {
      const x = actionBar.hotkey(Number(digit[1]));
      if (x) chooseAction(x);
    } else if (e.code === 'PageUp') setViewedFloor(f + 1);
    else if (e.code === 'PageDown') setViewedFloor(f - 1);
    else if (e.code === 'KeyG') arena.toggleGrid();
    else if (e.code === 'KeyT') toggleSpeed();
    else if (e.code === 'KeyH') hud.toggleHelp();
    else if (e.code === 'Home') focus.focusOverview(map, OVERVIEW_RADIUS);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') void endTurn();
    else if (e.code === 'Escape') {
      cameraEvents.interrupt();
      if (tactical.aiming) tactical.cancelAiming();
      else tactical.clearSelection();
    } else return;
    e.preventDefault();
  });

  bars.sync(match.state);
  // Visão geral até o START_MATCH (a câmera vai para o primeiro personagem da iniciativa).
  focus.focusOverview(map, OVERVIEW_RADIUS);
  camera.snap();
  void match.execute({ type: 'START_MATCH' });

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
    input.update(dt);
    camera.update(dt);
    occlusion.update();
    const shown = match.displayedState;
    hud.update({
      mapName: mapDef.name,
      state: shown,
      viewedFloor: arena.floorView.viewedFloor,
      floors: map.floors,
      orientation: camera.orientation,
      radius: camera.radius,
      grid: arena.isGridVisible,
      selectedUnitId: tactical.selectedUnitId,
      inspected: tactical.inspected,
      busy: match.busy,
      aiming: tactical.aiming?.name ?? null,
    });
    actionBar.update({ state: shown, busy: match.busy, aimingKey: tactical.aiming?.key ?? null });
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  console.info(`[arena] semente dos dados: ${seed} (use ?seed=${seed} para repetir)`);

  return {
    engine,
    scene,
    get state() {
      return match.state;
    },
    match,
    arena,
    camera,
    cameraEvents,
    focus,
    tactical,
    actionBar,
    hud,
    setViewedFloor,
    endTurn,
    chooseAction: (key) => chooseAction(key),
    cellToScreen(c) {
      const w = cellToWorld(c);
      const vw = engine.getRenderWidth();
      const vh = engine.getRenderHeight();
      const p = Vector3.Project(new Vector3(w.x, w.y, w.z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.camera.viewport.toGlobal(vw, vh));
      return { x: (p.x * canvas.clientWidth) / vw, y: (p.y * canvas.clientHeight) / vh };
    },
    reachable() {
      const u = match.activeUnit;
      if (!u) return [];
      return [...reachableCells(match.state, catalog, u.pos, u.mp)]
        .map(([, r]) => r)
        .filter((r) => r.cost > 0 && coordKey(r.coord) !== coordKey(u.pos))
        .map((r) => ({ ...r.coord, cost: r.cost }));
    },
    ready: arena.whenLoaded(),
  };
}
