/**
 * Tela da arena (Fase 2, etapa 1): monta a cena 3D a partir do core e liga câmera e HUD.
 * O estado vem de `buildScenario` (mesmo core do Combat Debug Lab); nesta etapa ele não
 * muda — a seleção, o movimento e os comandos chegam nas próximas etapas.
 */
import { Color4, Engine, Scene, Vector3 } from '@babylonjs/core';
import { buildScenario, type Catalog, type GameState } from '@bardurinho/domain';
import type { MapDefinition } from '@bardurinho/content';
import { ArenaView } from '../rendering/ArenaView.js';
import { CameraBounds, CameraController, CameraEventQueue, CameraFocus, CameraInput, CameraOcclusion, FOCUS_RADIUS } from '../rendering/camera/index.js';
import { arenaBounds, floorToWorldY } from '../rendering/grid.js';
import { Hud } from './hud.js';

const OVERVIEW_RADIUS = 46;

export interface ArenaScreen {
  engine: Engine;
  scene: Scene;
  state: GameState;
  arena: ArenaView;
  camera: CameraController;
  focus: CameraFocus;
  setViewedFloor(floor: number): void;
  ready: Promise<void>;
}

export function startArenaScreen(canvas: HTMLCanvasElement, hudRoot: HTMLElement, catalog: Catalog, mapDef: MapDefinition): ArenaScreen {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  // Sistema destro, igual ao glTF: os GLBs entram sem espelhamento (ver rendering/grid.ts).
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.08, 0.085, 0.095, 1);
  scene.ambientColor.set(0.25, 0.25, 0.25);

  const state = buildScenario(catalog, mapDef.scenario);
  const map = state.map;
  const arena = new ArenaView(scene, state);

  const b = arenaBounds(map);
  const bounds = new CameraBounds({ ...b, margin: 4, minRadius: 10, maxRadius: 60 });
  const camera = new CameraController(scene, bounds, new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), OVERVIEW_RADIUS);
  const focus = new CameraFocus(camera);
  const events = new CameraEventQueue();
  const occlusion = new CameraOcclusion();

  const focusActive = () => {
    const unit = state.turn.activeUnitId ? state.units[state.turn.activeUnitId] : undefined;
    if (unit) focus.focusCell(unit.pos, Math.min(camera.radius, FOCUS_RADIUS));
  };
  const input = new CameraInput(camera, canvas, { focusActive, onManualInput: () => events.interrupt() });

  const setViewedFloor = (floor: number) => {
    arena.floorView.setViewedFloor(floor);
    camera.setFocusHeight(floorToWorldY(arena.floorView.viewedFloor));
  };

  // Teclas da tela (não são da câmera): andar visualizado, grade de debug, visão geral.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const f = arena.floorView.viewedFloor;
    if (e.code === 'PageUp') setViewedFloor(f + 1);
    else if (e.code === 'PageDown') setViewedFloor(f - 1);
    else if (/^Digit[1-9]$/.test(e.code)) setViewedFloor(Number(e.code.slice(5)) - 1);
    else if (e.code === 'KeyG') arena.toggleGrid();
    else if (e.code === 'Home') focus.focusOverview(map, OVERVIEW_RADIUS);
    else return;
    e.preventDefault();
  });

  // Início da partida (seção 14.14): câmera posicionada no personagem ativo.
  focusActive();
  camera.snap();

  const hud = new Hud(hudRoot, catalog);
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
    input.update(dt);
    camera.update(dt);
    occlusion.update();
    hud.update({
      mapName: mapDef.name,
      state,
      viewedFloor: arena.floorView.viewedFloor,
      floors: map.floors,
      orientation: camera.orientation,
      radius: camera.radius,
      grid: arena.isGridVisible,
    });
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  return { engine, scene, state, arena, camera, focus, setViewedFloor, ready: arena.whenLoaded() };
}
