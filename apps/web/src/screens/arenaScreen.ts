/**
 * Tela da arena (Fase 2): monta a cena 3D a partir do core e liga câmera, HUD, seleção e
 * comandos. O estado oficial fica no MatchController; a cena só o lê (`ArenaView.sync`).
 *
 * Etapa 2: dados aleatórios com semente nova, seleção/picking, destaques de alcance e
 * caminho, movimento animado e encerrar turno — partida local controlando os dois lados.
 * Etapa 3: barra de ações (1–9), modo de habilidade (mira com área e chance de acerto),
 * dados na tela, barras sobre os personagens, iniciativa, câmera automática mínima
 * (CameraEventQueue) e tela de fim de partida.
 * Etapa 5: oclusão da câmera (CameraOcclusion), andar visualizado que acompanha o
 * personagem da vez, fantasmas consistentes (modelo, barra, rótulos, efeitos) e fila de
 * câmera com prioridade/duração/enquadramento.
 * Etapa 6: tela de opções (Esc / botão: câmera automática, ritmo, sensibilidade, inverter,
 * tremor; guardadas no navegador), resultado com resumo e reiniciar / jogar novamente.
 * Fase 3: a partida vem de um `MatchDriver` — local (`MatchController`) ou em rede
 * (`NetworkMatch`: o servidor decide, a tela só mostra a visão da equipe e só deixa dar
 * ordens aos personagens dela; painel de rede com cronômetro, presença e sincronização).
 */
import { Color4, Engine, Matrix, Scene, Vector3 } from '@babylonjs/core';
import { buildScenario, coordKey, reachableCells, type ActionInfo, type Catalog, type Coord, type GameState, type GameplayCommand } from '@bardurinho/domain';
import { decodeSetup, scenarioFromSetup, type MapDefinition } from '@bardurinho/content';
import { MatchController, type MatchDriver } from '../game/MatchController.js';
import type { NetworkMatch } from '../network/NetworkMatch.js';
import { NetworkHud } from './networkHud.js';
import { TacticalInteraction } from '../game/TacticalInteraction.js';
import { ArenaView } from '../rendering/ArenaView.js';
import { CameraBounds, CameraController, CameraEventQueue, CameraFocus, CameraInput, CameraOcclusion, FOCUS_RADIUS } from '../rendering/camera/index.js';
import { pace } from '../rendering/anim.js';
import { playEvents, type Spotlight } from '../rendering/eventPlayback.js';
import { arenaBounds, cellToWorld, floorToWorldY } from '../rendering/grid.js';
import { UnitStatusBars } from '../rendering/unitBars.js';
import { WorldLabels } from '../rendering/worldLabels.js';
import { ActionBar } from './actionBar.js';
import { Hud } from './hud.js';
import { OptionsMenu } from './optionsMenu.js';
import { loadSettings, saveSettings, type ClientSettings } from './settings.js';
import { summarizeMatch } from '../game/matchSummary.js';
import { Sfx } from '../rendering/sfx.js';

const OVERVIEW_RADIUS = 46;

export interface ArenaScreen {
  engine: Engine;
  scene: Scene;
  /** Estado oficial atual (somente leitura). */
  readonly state: GameState;
  match: MatchDriver;
  /** Modo em rede: a partida do servidor (senão `null`). */
  network: NetworkMatch | null;
  arena: ArenaView;
  camera: CameraController;
  cameraEvents: CameraEventQueue;
  focus: CameraFocus;
  tactical: TacticalInteraction;
  actionBar: ActionBar;
  hud: Hud;
  occlusion: CameraOcclusion;
  options: OptionsMenu;
  /** Preferências atuais do cliente (tela de opções). */
  readonly settings: ClientSettings;
  /** Escolha manual do andar visualizado (PgUp/PgDn). */
  setViewedFloor(floor: number): void;
  /** Andar escolhido pelo jogador (o visualizado sobe acima dele quando o personagem da vez sobe). */
  readonly preferredFloor: number;
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
 * a posição `x,y[,andar]`) dos personagens do cenário de exemplo, na ordem; `+itens` dá
 * consumíveis (`mage@8,12+health_potion,oil_flask` → `consumable.health_potion`, …). Só muda a
 * montagem do cenário; as regras são as mesmas. Sem o parâmetro, o cenário do mapa é usado como está.
 */
export function scenarioOverride(mapDef: MapDefinition, catalog: Catalog, search = location.search): MapDefinition['scenario'] {
  // Fase 4: `?setup=A=warrior:vitality_amulet:health_potion,focus_potion|rogue;B=mage` monta as
  // equipes (tela de escolha); `?units=` continua valendo por cima (posições/classe, depuração).
  const setupText = new URLSearchParams(search).get('setup');
  const setup = setupText ? decodeSetup(catalog, setupText) : null;
  const base = setup ? scenarioFromSetup(mapDef, catalog, setup) : mapDef.scenario;
  const raw = new URLSearchParams(search).get('units');
  if (!raw) return base;
  const specs = raw.split(';').map((entry) => {
    // '+' vira espaço na query string sem codificação: aceita os dois.
    const [main, items] = entry.trim().split(/[+\s]+/);
    const [classId, at] = (main ?? '').split('@');
    const [x, y, floor] = (at ?? '').split(',').map(Number);
    const consumables = (items ?? '')
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean)
      .map((i) => (i.includes('.') ? i : `consumable.${i}`))
      .filter((i) => catalog.items[i]?.kind === 'consumable');
    return { classId: classId?.trim() ?? '', pos: at ? { x: x!, y: y!, floor: floor || 0 } : null, consumables };
  });
  const units = base.units?.map((u, i) => {
    const spec = specs[i];
    if (!spec || !catalog.classes[spec.classId]) return u;
    // Mesma classe (só posição/itens): mantém o id do cenário (ex.: o do `?setup=`).
    return { ...u, classId: spec.classId, id: 'classId' in u && u.classId === spec.classId ? u.id : `${spec.classId}-0${i + 1}`, ...(spec.pos ? { pos: spec.pos } : {}), ...(spec.consumables.length ? { consumables: spec.consumables } : {}) };
  });
  // A ordem fixa do cenário cita os ids antigos.
  const renamed = new Map((base.units ?? []).map((u, i) => [u.id, units?.[i]?.id ?? u.id]));
  const order = base.order?.map((id) => renamed.get(id) ?? id);
  return { ...base, units, ...(order ? { order } : {}) };
}

/** Semente dos dados: `?seed=123` na URL (reprodutível) ou aleatória. */
function matchSeed(): number {
  const fromUrl = Number(new URLSearchParams(location.search).get('seed'));
  return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : newSeed();
}
const newSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 1));

export interface NetworkModeOptions {
  match: NetworkMatch;
  /** Sai da partida e volta ao lobby. */
  leave(): void;
  /**
   * Fase 5 (ciclo de jogo): botões da tela de resultado (recompensas / lobby) e "Desistir"
   * no painel da partida.
   */
  game?: {
    endActions: NonNullable<import('./hud.js').HudActions['endActions']>;
    endSubtitle?: (state: GameState) => string | null;
  };
  /**
   * Fase 7 (teste externo): contador de sinais de atrito da interface/câmera (telemetria, só
   * com consentimento) e "reportar bug" no painel da partida.
   */
  telemetry?: { count(name: string): void };
  reportBug?: () => void;
}

export function startArenaScreen(canvas: HTMLCanvasElement, hudRoot: HTMLElement, catalog: Catalog, mapDef: MapDefinition, net?: NetworkModeOptions): ArenaScreen {
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
  // Depuração (Fase 4, só partida local): `?dice=average` usa o modo "média fixa" dos cenários de
  // teste (cada dado vale a média; d20 = 11) para roteiros determinísticos (tools/e2e/conteudo.ts).
  const dice = new URLSearchParams(location.search).get('dice') === 'average' ? 'average' : 'random';
  const match: MatchDriver = net?.match ?? new MatchController(catalog, buildScenario(catalog, { ...scenarioOverride(mapDef, catalog), dice, seed, autoStart: false }));
  const map = match.state.map;
  const arena = new ArenaView(scene, match.state);
  // Fase 5: cosméticos do personagem de cada assento (cor, conjunto visual, aura).
  for (const seat of net?.match.seatList ?? []) if (seat.character?.appearance) arena.setTeamAppearance(seat.team, seat.character.appearance);

  const b = arenaBounds(map);
  const bounds = new CameraBounds({ ...b, margin: 4, minRadius: 10, maxRadius: 60 });
  const camera = new CameraController(scene, bounds, new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), OVERVIEW_RADIUS);
  const focus = new CameraFocus(camera);
  const cameraEvents = new CameraEventQueue();
  const occlusion = new CameraOcclusion(camera.camera, arena.floorView);
  arena.occluders.forEach((o, i) => occlusion.addStatic(`${o.kind}:${o.floor}:${i}`, o.meshes, o.floor));
  occlusion.objectSource = function* () {
    for (const v of arena.objectViews()) yield { id: v.id, root: v.root, floor: arena.floorView.floorOf(v.root) ?? 0 };
  };
  /** Envolvidos na reprodução em curso (preenchido pelo eventPlayback). */
  const spotlight: Spotlight = { entities: new Set(), cells: [] };

  const setViewedFloor = (floor: number) => {
    arena.floorView.setViewedFloor(floor);
    camera.setFocusHeight(floorToWorldY(arena.floorView.viewedFloor));
  };
  /**
   * Andar visualizado (seção 14.6): o jogador escolhe um andar (PgUp/PgDn, padrão = o mais
   * alto, tudo sólido); o visualizado é max(escolhido, andar do personagem da vez) — ao subir
   * a escada acima do escolhido, a visualização sobe junto; ao descer, volta ao escolhido.
   * Reaplicado no início do turno, na troca de andar na escada e ao sair da mira.
   */
  let preferredFloor = map.floors - 1;
  const chooseFloor = (floor: number) => {
    preferredFloor = Math.max(0, Math.min(map.floors - 1, floor));
    setViewedFloor(preferredFloor);
  };
  const followActive = () => {
    const unit = match.activeUnit;
    setViewedFloor(Math.max(preferredFloor, unit?.pos.floor ?? 0));
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
  // Zoom de antes da reprodução: o retorno ao executor ('restore') desfaz a abertura da explosão.
  let radiusBeforePlayback = camera.radius;
  cameraEvents.onBegin = () => (radiusBeforePlayback = camera.radius);
  cameraEvents.runner = (shot) => {
    const cell = shot.targetCell ?? (shot.targetEntity ? match.state.units[shot.targetEntity]?.pos : undefined);
    const radius = shot.radius === 'restore' ? radiusBeforePlayback : shot.radius;
    if (cell) focusCell(cell, radius);
  };
  // Entrada manual: interrompe a câmera automática e para a transição onde está (14.12).
  const manualInput = () => {
    if (match.busy && !cameraEvents.isInterrupted) camera.settle();
    cameraEvents.interrupt();
  };
  // Tremor das explosões (desligado junto com a câmera automática).
  arena.vfx.shake = (amplitude, seconds) => {
    if (cameraEvents.preference !== 'off' && settings.cameraShake) camera.shake(amplitude, seconds);
  };
  const setFast = (fast: boolean) => {
    pace.setFast(fast);
    hud.setFast(pace.fast);
    options.setFast(pace.fast);
  };
  const toggleSpeed = () => {
    signal('speed');
    setFast(!pace.fast);
  };
  const input = new CameraInput(camera, canvas, { focusActive, onManualInput: manualInput });

  // Preferências do cliente (tela de opções, etapa 6).
  let settings = loadSettings();
  // Fase 4: efeitos sonoros (WebAudio, volume nas opções). `window.__sfx` para depuração/e2e.
  const sfx = new Sfx();
  /** Fase 7: sinal de atrito/uso para a telemetria (nada acontece sem o teste externo). */
  const signal = (name: string) => net?.telemetry?.count(name);
  (window as unknown as { __sfx: Sfx }).__sfx = sfx;
  const applySettings = (s: ClientSettings) => {
    settings = s;
    sfx.volume = s.sfxVolume;
    cameraEvents.preference = s.autoCamera;
    input.sensitivity = s.cameraSensitivity;
    input.invertDrag = s.invertDrag;
    input.invertZoom = s.invertZoom;
  };
  applySettings(settings);
  /** Recarrega a tela: mesma semente (reiniciar) ou semente nova (jogar novamente). */
  const reload = (sameSeed: boolean) => {
    // Em rede, nova partida = voltar ao lobby (o servidor decide semente e reinício).
    if (net) return net.leave();
    const params = new URLSearchParams(location.search);
    params.set('seed', String(sameSeed ? seed : newSeed()));
    location.search = params.toString();
  };

  const hud = new Hud(hudRoot, catalog, {
    endTurn: () => void endTurn(),
    execute: (command) => void execute(command),
    aim: (action) => void tactical.startAiming(action),
    // Nova partida = recarregar com uma semente nova (reconstrói cena e estado do zero).
    newMatch: () => reload(false),
    restart: () => reload(true),
    openOptions: () => options.open(),
    summary: () => summarizeMatch(match.state, match.history),
    toggleSpeed: () => toggleSpeed(),
    ...(net?.game ? { endActions: net.game.endActions, ...(net.game.endSubtitle ? { endSubtitle: net.game.endSubtitle } : {}) } : {}),
  });
  hud.setFast(pace.fast);
  const options = new OptionsMenu(hudRoot, settings, pace.fast, {
    change: (s) => {
      applySettings(s);
      saveSettings(s);
    },
    setFast,
    restart: () => reload(true),
    newMatch: () => reload(false),
    toggled: (open) => {
      input.enabled = !open;
      if (open) tactical.cancelAiming();
    },
  });
  const labels = new WorldLabels(scene, engine, hudRoot);
  // Rótulo de algo num andar fantasma fica translúcido como o dono (barra, números, dados).
  labels.ghostAt = (p) => {
    for (const v of arena.unitViews()) {
      const r = v.root.position;
      if (Math.abs(p.x - r.x) < 0.9 && Math.abs(p.z - r.z) < 0.9 && p.y > r.y - 0.5 && p.y < r.y + 3.6) return v.isGhost;
    }
    // Sem dono: andar pela altura (rótulos de célula ficam ~0–0,5 m acima do piso).
    return arena.floorView.isGhost(Math.max(0, Math.floor((p.y - 3.6) / 4) + 1));
  };
  const bars = new UnitStatusBars(arena, labels, catalog);
  const tactical = new TacticalInteraction({
    scene,
    canvas,
    arena,
    match,
    catalog,
    labels,
    onManualInput: manualInput,
    onModeChange: () => {
      // Mira com alvos válidos num andar acima do visualizado: sobe a visualização (os alvos
      // ficariam fantasmas e sem picking); ao sair da mira, volta à regra normal.
      const a = tactical.aiming;
      if (!a) return followActive();
      let top = arena.floorView.viewedFloor;
      for (const t of a.cells.values()) if (t.valid) top = Math.max(top, t.cell.floor);
      if (top > arena.floorView.viewedFloor) setViewedFloor(top);
    },
  });
  // Oclusão (14.7): o que deve ficar à vista — personagens vivos (peito e cabeça), célula
  // sob o cursor, células válidas da mira e, durante a reprodução, os envolvidos.
  occlusion.targets = () => {
    const pts: Array<{ x: number; y: number; z: number; entityId?: string }> = [];
    const cell = (c: Coord, lift: number, entityId?: string) => {
      const w = cellToWorld(c);
      pts.push({ x: w.x, y: w.y + lift, z: w.z, entityId });
    };
    for (const v of arena.unitViews()) {
      if (!v.root.isEnabled() || !v.alive || v.isGhost) continue;
      const id = (v.root.metadata as { entityId: string }).entityId;
      const p = v.root.position;
      pts.push({ x: p.x, y: p.y + 1.0, z: p.z, entityId: id }, { x: p.x, y: p.y + 1.75, z: p.z, entityId: id });
    }
    if (tactical.hoverCell) cell(tactical.hoverCell, 0.4);
    // Chão sob o cursor atrás de um muro/porta: esmaece o que está na frente (etapa 6).
    if (tactical.pointerFloorCell) cell(tactical.pointerFloorCell, 0.4);
    if (tactical.aiming) for (const t of tactical.aiming.cells.values()) if (t.valid) cell(t.cell, 0.5);
    if (match.busy) {
      for (const c of spotlight.cells) cell(c, 0.6);
      for (const id of spotlight.entities) {
        const o = arena.objectView(id);
        if (o) pts.push({ x: o.root.position.x, y: o.root.position.y + 0.8, z: o.root.position.z, entityId: id });
      }
    }
    return pts;
  };
  const actionBar = new ActionBar(hudRoot, catalog, { choose: (x) => chooseAction(x) });

  match.presenter = {
    play: (evs, _before, after) =>
      playEvents(
        {
          scene,
          arena,
          labels,
          catalog,
          bars,
          camera: cameraEvents,
          after,
          spotlight,
          sfx,
          onInitiative: (rolls, order) => hud.showInitiative(after, rolls, order),
          // O andar visualizado acompanha o personagem da vez na escada.
          onFloorChange: (unitId, floor) => {
            if (unitId === match.state.turn.activeUnitId) setViewedFloor(Math.max(preferredFloor, floor));
          },
        },
        evs,
      ),
    sync: (state) => {
      arena.sync(state);
      bars.sync(state);
    },
    rejected: (error) => {
      signal('rejected');
      sfx.play('ui.error');
      hud.toast(error.message);
    },
  };
  match.onChange(({ before, state }) => {
    // Novo turno: seleciona e enquadra o personagem da vez.
    if (state.turn.turnId !== before.turn.turnId) {
      followActive();
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
    if (!unit || match.busy || !match.canControl(unit.id)) return;
    await execute({ type: 'END_TURN', actorId: unit.id });
  }

  /** Carta da barra: sem alvo executa; com alvo entra no modo de habilidade; Mover volta ao tático. */
  function chooseAction(x: ActionInfo | string): void {
    const action = typeof x === 'string' ? actionBar.list.find((a) => a.key === x) : x;
    if (!action || match.busy || !match.canControl(match.state.turn.activeUnitId)) return;
    if (action.kind === 'move') {
      tactical.cancelAiming();
      // Volta a selecionar o personagem da vez (o jogador pode ter inspecionado outro).
      if (match.activeUnit && tactical.selectedUnitId !== match.activeUnit.id) tactical.selectUnit(match.activeUnit.id);
      if (!action.available) {
        signal('unavailable');
        hud.toast(action.reason?.message ?? 'Movimento indisponível');
      }
      return;
    }
    if (!action.available) {
      signal('unavailable');
      hud.toast(action.reason?.message ?? 'Ação indisponível');
      return;
    }
    if (action.command) void execute(action.command as GameplayCommand);
    else tactical.startAiming(action);
  }

  // Teclas da tela (não são da câmera): ações 1–9, andar visualizado, grade, visão geral, turno.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    // Tela de opções aberta: só Esc (fecha); o resto da partida não recebe teclas.
    if (options.isOpen) {
      if (e.code === 'Escape') {
        options.close();
        e.preventDefault();
      }
      return;
    }
    const f = arena.floorView.viewedFloor;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) {
      const x = actionBar.hotkey(Number(digit[1]));
      if (x) chooseAction(x);
    } else if (e.code === 'PageUp') {
      signal('floorChange');
      chooseFloor(f + 1);
    } else if (e.code === 'PageDown') {
      signal('floorChange');
      chooseFloor(f - 1);
    } else if (e.code === 'KeyG') arena.toggleGrid();
    else if (e.code === 'KeyT') toggleSpeed();
    else if (e.code === 'KeyH') {
      signal('help');
      hud.toggleHelp();
    } else if (e.code === 'Home') {
      signal('overview');
      focus.focusOverview(map, OVERVIEW_RADIUS);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') void endTurn();
    else if (e.code === 'Escape') {
      manualInput();
      // Esc cancela a mira; sem mira abre as opções (limpar a seleção: clique direito).
      if (tactical.aiming) {
        signal('aimCancel');
        tactical.cancelAiming();
      } else {
        signal('options');
        options.open();
      }
    } else return;
    e.preventDefault();
  });

  bars.sync(match.state);
  // Visão geral até o START_MATCH (a câmera vai para o primeiro personagem da iniciativa).
  focus.focusOverview(map, OVERVIEW_RADIUS);
  camera.snap();
  const netHud = net
    ? new NetworkHud(hudRoot, net.match, {
        leave: () => net.leave(),
        ...(net.reportBug ? { reportBug: net.reportBug } : {}),
        ...(net.game
          ? {
              surrender: () => {
                const mine = Object.values(match.state.units).find((u) => u.alive && match.canControl(u.id));
                if (mine && match.state.status === 'active') void match.execute({ type: 'SURRENDER', actorId: mine.id });
              },
            }
          : {}),
      })
    : null;
  if (!net) void match.execute({ type: 'START_MATCH' });
  else {
    // Entrou numa partida já em andamento (reconexão, seção 14.14): câmera no personagem da vez.
    const enterActive = () => {
      if (match.state.status !== 'active') return;
      followActive();
      tactical.selectUnit(match.canControl(match.state.turn.activeUnitId) ? match.state.turn.activeUnitId : (Object.values(match.state.units).find((u) => match.canControl(u.id))?.id ?? null));
      focusActive();
      camera.snap();
    };
    enterActive();
    net.match.onSnapshot = () => {
      tactical.cancelAiming();
      enterActive();
    };
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
    input.update(dt);
    cameraEvents.update(dt * pace.speed);
    camera.update(dt);
    occlusion.update(dt);
    const shown = match.displayedState;
    const controllable = shown.status === 'active' && match.canControl(shown.turn.activeUnitId);
    netHud?.update();
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
      controllable,
    });
    actionBar.update({ state: shown, busy: match.busy, aimingKey: tactical.aiming?.key ?? null, controllable });
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  if (net) console.info(`[arena] partida em rede ${net.match.matchId} — equipe ${net.match.team}`);
  else console.info(`[arena] semente dos dados: ${seed} (use ?seed=${seed} para repetir)`);

  return {
    engine,
    scene,
    get state() {
      return match.state;
    },
    match,
    network: net?.match ?? null,
    arena,
    camera,
    cameraEvents,
    focus,
    tactical,
    actionBar,
    hud,
    occlusion,
    options,
    get settings() {
      return settings;
    },
    setViewedFloor: chooseFloor,
    get preferredFloor() {
      return preferredFloor;
    },
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
