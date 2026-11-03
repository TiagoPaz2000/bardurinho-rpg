import './style.css';
import './actions.css';
import { catalog } from '@bardurinho/content';
import {
  DAMAGE_TYPES,
  coordKey,
  createDummy,
  createObject,
  createUnitFromClass,
  crossArea,
  entitiesAt,
  findPath,
  getCell,
  lineOfSight,
  listActionsOnTarget,
  listUnitActions,
  isHidden,
  projectStateForTeam,
  teamDetects,
  type ActionInfo,
  unitAt,
  type Command,
  type Coord,
  type DamageType,
  type EffectOp,
  type ExecutionOptions,
  type GameEvent,
  type GameState,
  type SurfaceKind,
  type Terrain,
  type Unit,
} from '@bardurinho/domain';
import { defaultScenario } from './defaultScenario.js';
import { download, fmtCoord, h } from './dom.js';
import { CELL, render, renderLegend, type Layers } from './render.js';

const legendPanel = renderLegend(); // estática: criada uma vez
import { LabSession } from './session.js';

// ---------------------------------------------------------------------------
// Estado da interface (não é estado de jogo)
// ---------------------------------------------------------------------------

type Armed =
  | { kind: 'attack'; weaponId: string; label: string }
  | { kind: 'ability'; abilityId: string; label: string }
  | { kind: 'useItem'; itemId: string; label: string }
  | { kind: 'effect'; effects: EffectOp[]; label: string; definitionId: string }
  | { kind: 'paintSurface'; surface: SurfaceKind | null; label: string }
  | { kind: 'paintTerrain'; terrain: Terrain | 'dark'; label: string }
  | { kind: 'placeUnit'; classId: string; label: string }
  | { kind: 'placeDummy'; presetId: string; label: string }
  | { kind: 'placeObject'; defId: string; label: string }
  | { kind: 'erase'; label: string }
  | { kind: 'measure'; label: string };

type ExecMode = 'normal' | 'ignoreCost' | 'ignoreCooldown' | 'ignoreTurn' | 'force';

const EXEC_OPTIONS: Record<ExecMode, ExecutionOptions> = {
  normal: {},
  ignoreCost: { ignoreCost: true },
  ignoreCooldown: { ignoreCooldown: true },
  ignoreTurn: { ignoreTurn: true },
  force: { ignoreCost: true, ignoreCooldown: true, ignoreTurn: true },
};

const ui = {
  session: new LabSession(catalog, defaultScenario),
  floor: 0,
  execMode: 'normal' as ExecMode,
  layers: {
    terrain: true, surface: true, objects: true, units: true,
    coordinates: true, movementCost: false, reachable: true, lineOfSight: false, attackRange: true,
  } as Layers,
  armed: null as Armed | null,
  selectedCell: null as Coord | null,
  lastClickedCell: null as Coord | null,
  bottomTab: 'actions' as 'actions' | 'timeline' | 'legend',
  visionTeam: null as string | null,
  selectedUnitId: 'mage-01' as string | null,
  hoverCell: null as Coord | null,
  search: '',
  collapsed: new Set<string>(),
  selectedEventSeq: null as number | null,
  brushCross: false,
  surfaceViaEvent: false,
  measureFrom: null as Coord | null,
  measureInfo: null as string | null,
  form: { amount: 20, damageType: 'physical' as DamageType, ignoreArmor: false, statusId: 'burning', team: 'A' },
  message: null as { text: string; kind: 'ok' | 'error' } | null,
};

const state = (): GameState => ui.session.state;
const selectedUnit = (): Unit | undefined => (ui.selectedUnitId ? state().units[ui.selectedUnitId] : undefined);
const actor = (): Unit | undefined => selectedUnit() ?? (state().turn.activeUnitId ? state().units[state().turn.activeUnitId!] : undefined);

function exec(command: Command): boolean {
  const ok = ui.session.execute(command, EXEC_OPTIONS[ui.execMode]);
  const err = ui.session.lastError;
  ui.message = ok ? null : { text: `${command.type}: ${err?.code} — ${err?.message}`, kind: 'error' };
  return ok;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;
const toolbar = h('header', { class: 'toolbar' });
const sidebar = h('aside', { class: 'sidebar' });
const canvas = h('canvas', { class: 'grid' });
const center = h('main', { class: 'center' }, h('div', { class: 'canvas-wrap' }, canvas));
const inspector = h('section', { class: 'inspector' });
const timeline = h('footer', { class: 'timeline' });
app.append(toolbar, h('div', { class: 'body' }, sidebar, center, inspector), timeline);
const g = canvas.getContext('2d')!;

function cellFromEvent(ev: MouseEvent): Coord | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left) / CELL);
  const y = Math.floor((ev.clientY - rect.top) / CELL);
  return getCell(state().map, { x, y, floor: ui.floor }) ? { x, y, floor: ui.floor } : null;
}

canvas.addEventListener('mousemove', (ev) => {
  const c = cellFromEvent(ev);
  if (c?.x !== ui.hoverCell?.x || c?.y !== ui.hoverCell?.y) {
    ui.hoverCell = c;
    drawGrid();
  }
});
canvas.addEventListener('mouseleave', () => {
  ui.hoverCell = null;
  drawGrid();
});
canvas.addEventListener('click', (ev) => {
  const c = cellFromEvent(ev);
  if (c) onCellClick(c);
});
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  ui.armed = null;
  ui.measureFrom = null;
  refresh();
});
document.addEventListener('keydown', (ev) => {
  if ((ev.target as HTMLElement).tagName === 'INPUT') return;
  if (ev.key === 'Escape') ui.armed = null;
  else if (ev.key === 'e' && state().turn.activeUnitId) exec({ type: 'END_TURN', actorId: state().turn.activeUnitId! });
  else if (ev.key === 'ArrowLeft') ui.session.stepBack();
  else if (ev.key === 'ArrowRight') ui.session.stepForward();
  else return;
  refresh();
});

// ---------------------------------------------------------------------------
// Clique no grid
// ---------------------------------------------------------------------------

function onCellClick(c: Coord): void {
  ui.selectedCell = c;
  const armed = ui.armed;
  const target = { kind: 'cell' as const, ...c };
  const a = actor();

  if (!armed) {
    // 1º clique: seleciona/inspeciona a célula. 2º clique na mesma célula vazia: move o personagem selecionado.
    const previous = ui.lastClickedCell;
    ui.lastClickedCell = c;
    const unit = unitAt(state(), c);
    // Ao clicar em algo no mapa, a aba de ações mostra o que pode ser feito.
    if (entitiesAt(state(), c).length > 0) ui.bottomTab = 'actions';
    if (unit) {
      // Bonecos não agem: clicar neles mantém o personagem atual como ator.
      if (!unit.flags.isDummy) ui.selectedUnitId = unit.id;
    } else if (
      previous && coordKey(previous) === coordKey(c) &&
      a && !a.flags.isDummy && getCell(state().map, c)?.terrain === 'ground' && entitiesAt(state(), c).length === 0
    ) {
      exec({ type: 'MOVE', actorId: a.id, to: c });
      ui.lastClickedCell = null;
    }
    return refresh();
  }
  ui.lastClickedCell = null;

  switch (armed.kind) {
    case 'attack':
      if (a) exec({ type: 'BASIC_ATTACK', actorId: a.id, weaponId: armed.weaponId, target });
      ui.armed = null;
      break;
    case 'ability':
      if (a) exec({ type: 'USE_ABILITY', actorId: a.id, abilityId: armed.abilityId, target });
      ui.armed = null;
      break;
    case 'useItem':
      if (a) exec({ type: 'USE_ITEM', actorId: a.id, itemId: armed.itemId, target });
      ui.armed = null;
      break;
    case 'effect':
      exec({ type: 'DEBUG_APPLY_EFFECTS', ...(a ? { sourceId: a.id } : {}), definitionId: armed.definitionId, target, effects: armed.effects });
      ui.armed = null;
      break;
    case 'paintSurface': {
      const cells = ui.brushCross ? crossArea(c) : [c];
      if (ui.surfaceViaEvent && armed.surface) {
        exec({
          type: 'DEBUG_APPLY_EFFECTS', definitionId: 'debug.paint', target,
          effects: [{ op: 'createSurface', selector: ui.brushCross ? 'crossArea' : 'targetCell', surface: armed.surface, durationRounds: armed.surface === 'oil' ? null : 3 }],
        });
      } else {
        exec({ type: 'DEBUG_PAINT_SURFACE', cells, surface: armed.surface, durationRounds: armed.surface === 'fire' ? 3 : null });
      }
      break;
    }
    case 'paintTerrain':
      ui.session.editSetup((s) => {
        for (const p of ui.brushCross ? crossArea(c) : [c]) {
          const cell = getCell(s.map, p);
          if (!cell) continue;
          if (armed.terrain === 'dark') cell.dark = !cell.dark;
          else {
            cell.terrain = armed.terrain;
            if (armed.terrain !== 'ground') cell.surface = null;
          }
        }
      });
      break;
    case 'placeUnit':
    case 'placeDummy':
    case 'placeObject':
      ui.session.editSetup((s) => place(s, armed, c));
      ui.armed = null;
      break;
    case 'erase':
      ui.session.editSetup((s) => {
        for (const u of Object.values(s.units)) if (coordKey(u.pos) === coordKey(c)) {
          delete s.units[u.id];
          s.turn.order = s.turn.order.filter((id) => id !== u.id);
        }
        for (const o of Object.values(s.objects)) if (coordKey(o.pos) === coordKey(c)) delete s.objects[o.id];
      });
      ui.armed = null;
      break;
    case 'measure':
      if (!ui.measureFrom) {
        ui.measureFrom = c;
        ui.measureInfo = `Origem ${fmtCoord(c)} — clique no destino`;
      } else {
        const los = lineOfSight(state(), catalog, ui.measureFrom, c);
        const path = findPath(state(), catalog, ui.measureFrom, c);
        ui.measureInfo =
          `${fmtCoord(ui.measureFrom)} → ${fmtCoord(c)} | LINE_OF_SIGHT visible: ${los.visible}` +
          (los.reason ? ` reason: ${los.reason} em ${fmtCoord(los.blockedAt!)}` : '') +
          ` | caminho: ${path ? `${path.cost} PM (${path.path.length - 1} passos)` : 'inexistente'}`;
        ui.measureFrom = null;
        ui.armed = null;
      }
      break;
  }
  refresh();
}

function uniqueId(s: GameState, prefix: string): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}-${String(i).padStart(2, '0')}`;
    if (!s.units[id] && !s.objects[id]) return id;
  }
}

function place(s: GameState, armed: Armed, c: Coord): void {
  if (armed.kind === 'placeObject') {
    const id = uniqueId(s, armed.defId);
    s.objects[id] = createObject(catalog, { id, defId: armed.defId, pos: c });
    return;
  }
  if (Object.values(s.units).some((u) => coordKey(u.pos) === coordKey(c))) return;
  const unit =
    armed.kind === 'placeUnit'
      ? createUnitFromClass(catalog, { id: uniqueId(s, armed.classId), classId: armed.classId, team: ui.form.team, pos: c })
      : armed.kind === 'placeDummy'
        ? createDummy(catalog, { id: uniqueId(s, 'dummy'), presetId: armed.presetId, pos: c })
        : null;
  if (!unit) return;
  s.units[unit.id] = unit;
  s.turn.order.push(unit.id);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function renderToolbar(): void {
  const s = state();
  const active = s.turn.activeUnitId;
  const modeRadio = (mode: ExecMode, label: string) =>
    h('label', { class: mode === 'force' ? 'danger' : '' },
      h('input', { type: 'radio', name: 'exec', checked: ui.execMode === mode, onchange: () => { ui.execMode = mode; refresh(); } }),
      label);
  const layer = (key: keyof Layers, label: string) =>
    h('label', {}, h('input', { type: 'checkbox', checked: ui.layers[key], onchange: () => { ui.layers[key] = !ui.layers[key]; drawGrid(); } }), label);

  toolbar.replaceChildren(...[
    h('strong', {}, 'COMBAT DEBUG LAB'),
    h('span', { class: 'pill' }, `Rodada ${s.turn.round} · Turno #${s.turn.turnId} · ${active ?? '—'}`),
    s.status === 'finished' ? h('span', { class: 'pill danger' }, `FIM: ${JSON.stringify(s.result)}`) : null,
    h('button', { onclick: () => active && exec({ type: 'END_TURN', actorId: active }) && refresh(), disabled: !active, title: 'Atalho: E' }, 'Encerrar turno'),
    h('span', { class: 'group' }, 'Execução:', modeRadio('normal', 'Regras normais'), modeRadio('ignoreCost', 'Ignorar custo'),
      modeRadio('ignoreCooldown', 'Ignorar cooldown'), modeRadio('ignoreTurn', 'Ignorar turno'), modeRadio('force', 'Forçar execução (DEBUG)')),
    s.map.floors > 1
      ? h('span', { class: 'group' }, 'Andar:', ...Array.from({ length: s.map.floors }, (_, f) =>
          h('button', { class: ui.floor === f ? 'on' : '', onclick: () => { ui.floor = f; refresh(); } }, String(f))))
      : null,
    h('span', { class: 'group' }, 'Visão:',
      ...[null, ...teamsInMatch()].map((t) =>
        h('button', { class: ui.visionTeam === t ? 'on' : '', title: t ? `Mostra apenas o que a equipe ${t} vê` : 'Estado oficial completo',
          onclick: () => { ui.visionTeam = t; refresh(); } }, t ? `Equipe ${t}` : 'Servidor (tudo)'))),
    h('span', { class: 'group' }, 'Layers:', layer('coordinates', 'Coord.'), layer('movementCost', 'Custo PM'), layer('reachable', 'Alcance mov.'),
      layer('lineOfSight', 'Linha de visão'), layer('attackRange', 'Alcance ataque'), layer('surface', 'Superfícies'), layer('objects', 'Objetos')),
  ].filter((el): el is HTMLElement => !!el));
}

// ---------------------------------------------------------------------------
// Aba lateral de conteúdo — navegador do catálogo real
// ---------------------------------------------------------------------------

interface Entry {
  id: string;
  name: string;
  meta: string;
  tags: string[];
  version?: number;
  arm?: () => Armed | void;
}

function sidebarCategories(): Array<{ key: string; title: string; entries: Entry[]; extra?: HTMLElement }> {
  const items = Object.values(catalog.items);
  const amount = ui.form.amount;
  const dmg = ui.form.damageType;
  return [
    {
      key: 'characters', title: 'Personagens',
      extra: h('div', { class: 'row' }, 'Equipe:', ...['A', 'B'].map((t) =>
        h('button', { class: ui.form.team === t ? 'on' : '', onclick: () => { ui.form.team = t; refresh(); } }, t))),
      entries: Object.values(catalog.classes).map((c) => ({
        id: c.id, name: c.name, version: c.version, tags: c.tags,
        meta: `PV ${c.hp} · PA ${c.ap} · PM ${c.mp} · Foco ${c.maxFocus}`,
        arm: () => ({ kind: 'placeUnit', classId: c.id, label: `Colocar ${c.name} (equipe ${ui.form.team})` }),
      })),
    },
    {
      key: 'dummies', title: 'Bonecos de teste',
      entries: Object.values(catalog.dummies).map((d) => ({
        id: d.id, name: d.name, version: d.version, tags: d.tags,
        meta: `PV ${d.hp} · Arm ${d.armor} · Res ${JSON.stringify(d.resistances)}${d.immortal ? ' · imortal' : ''}`,
        arm: () => ({ kind: 'placeDummy', presetId: d.id, label: `Colocar ${d.name}` }),
      })),
    },
    {
      key: 'attacks', title: 'Ataques',
      entries: [
        ...items.filter((i) => i.kind === 'weapon').map((w) => ({
          id: w.id, name: w.name, version: w.version, tags: w.tags,
          meta: `${w.damage} ${w.damageType} · ${w.cost.ap} PA · alcance ${w.target.minRange ?? 1}–${w.target.range}`,
          arm: (): Armed => ({ kind: 'attack', weaponId: w.id, label: `Ataque: ${w.name}` }),
        })),
        {
          id: 'debug.direct_damage', name: 'Dano direto de teste', tags: ['DEBUG'],
          meta: `${amount} ${dmg}${ui.form.ignoreArmor ? ' · ignora armadura' : ''} (formulário em Efeitos)`,
          arm: (): Armed => ({ kind: 'effect', definitionId: 'debug.direct_damage', label: `Dano ${amount} ${dmg}`,
            effects: [{ op: 'damage', selector: 'targetCellOccupants', amount, damageType: dmg, ignoreArmor: ui.form.ignoreArmor }] }),
        },
      ],
    },
    {
      key: 'abilities', title: 'Magias',
      entries: Object.values(catalog.abilities).map((ab) => ({
        id: ab.id, name: ab.name, version: ab.version, tags: ab.tags,
        meta: `${catalog.classes[ab.classId]?.name} · ${ab.cost.ap} PA + ${ab.cost.focus ?? 0} Foco · ${ab.target.kind}${ab.target.range ? ` ${ab.target.minRange ?? 0}–${ab.target.range}` : ''} · recarga ${ab.blockedOwnTurnsAfterUse}`,
        arm: (): Armed | void => {
          if (ab.target.kind === 'self') {
            const a = actor();
            if (a) exec({ type: 'USE_ABILITY', actorId: a.id, abilityId: ab.id, target: { kind: 'self' } });
            return;
          }
          return { kind: 'ability', abilityId: ab.id, label: `Magia: ${ab.name}` };
        },
      })),
    },
    {
      key: 'items', title: 'Itens',
      entries: items.map((i) => ({
        id: i.id, name: i.name, version: i.version, tags: i.tags,
        meta: i.kind === 'consumable' ? `consumível · ${i.effects.map((e) => e.op).join(', ')}`
          : i.kind === 'armor' ? `armadura ${i.armor}` : i.kind === 'accessory' ? `acessório ${JSON.stringify(i.resistances ?? { maxHp: i.maxHpBonus })}` : `arma ${i.damage} ${i.damageType}`,
        arm: i.kind === 'consumable'
          ? (): Armed => ({ kind: 'effect', definitionId: i.id, effects: i.effects, label: `Aplicar efeito: ${i.name}` })
          : undefined,
      })),
    },
    {
      key: 'effects', title: 'Efeitos',
      extra: effectForm(),
      entries: ([
        ['Damage', [{ op: 'damage', selector: 'targetCellOccupants', amount, damageType: dmg, ignoreArmor: ui.form.ignoreArmor }]],
        ['Heal', [{ op: 'heal', selector: 'targetCellOccupants', amount }]],
        ['Shield', [{ op: 'grantShield', selector: 'targetCellOccupants', amount, ownTurns: 1 }]],
        ['Apply Status', [{ op: 'applyStatus', selector: 'targetCellOccupants', statusId: ui.form.statusId }]],
        ['Remove Status', [{ op: 'removeStatus', selector: 'targetCellOccupants', statusId: ui.form.statusId, reason: 'debug' }]],
        ['Restore Focus', [{ op: 'restoreResource', selector: 'targetCellOccupants', resource: 'focus', amount }]],
        ['Force Move (a partir do selecionado)', [{ op: 'forceMove', selector: 'targetCellOccupants', distance: 2, direction: 'awayFromSource' }]],
        ['Create Surface: fire', [{ op: 'createSurface', selector: 'targetCell', surface: 'fire', durationRounds: 3 }]],
        ['Remove Surface', [{ op: 'removeSurface', selector: 'targetCell' }]],
        ['Emit Heat', [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'heat' }]],
        ['Emit Cold', [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'cold' }]],
        ['Emit Water', [{ op: 'emitStimulus', selector: 'crossArea', stimulus: 'water' }]],
        ['Destroy Object', [{ op: 'changeObjectState', selector: 'targetCellOccupants', state: 'destroyed' }]],
        ['Kill', [{ op: 'damage', selector: 'targetCellOccupants', amount: 9999, damageType: 'physical', ignoreArmor: true }]],
      ] as Array<[string, EffectOp[]]>).map(([name, effects]) => ({
        id: `op.${effects[0]!.op}`, name, tags: ['DEBUG'], meta: effects.map((e) => JSON.stringify(e)).join(' '),
        arm: (): Armed => ({ kind: 'effect', effects, definitionId: `debug.${effects[0]!.op}`, label: `Efeito: ${name}` }),
      })),
    },
    {
      key: 'statuses', title: 'Estados',
      entries: Object.values(catalog.statuses).map((st) => ({
        id: st.id, name: st.name, version: st.version, tags: st.tags,
        meta: `${JSON.stringify(st.duration)}${st.tickDamage ? ` · ${st.tickDamage.amount} ${st.tickDamage.damageType}/turno` : ''}${st.modifiers ? ` · ${JSON.stringify(st.modifiers)}` : ''}`,
        arm: (): Armed => ({ kind: 'effect', definitionId: `debug.status.${st.id}`, label: `Aplicar estado: ${st.name}`,
          effects: [{ op: 'applyStatus', selector: 'targetCellOccupants', statusId: st.id }] }),
      })),
    },
    {
      key: 'surfaces', title: 'Superfícies',
      extra: h('div', { class: 'row' },
        h('label', {}, h('input', { type: 'checkbox', checked: ui.brushCross, onchange: () => { ui.brushCross = !ui.brushCross; refresh(); } }), 'Pincel cruz'),
        h('label', {}, h('input', { type: 'checkbox', checked: ui.surfaceViaEvent, onchange: () => { ui.surfaceViaEvent = !ui.surfaceViaEvent; refresh(); } }), 'Via evento de gameplay')),
      entries: [
        ...Object.values(catalog.surfaces).map((sf) => ({
          id: sf.id, name: sf.name, version: sf.version, tags: sf.tags,
          meta: `entrar: ${sf.enterCost} PM${sf.exposureDamage ? ` · ${sf.exposureDamage.amount} ${sf.exposureDamage.damageType}` : ''}`,
          arm: (): Armed => ({ kind: 'paintSurface', surface: sf.surface, label: `Pintar ${sf.name}` }),
        })),
        { id: 'surface.erase', name: 'Apagar superfície', tags: [], meta: 'pintura direta', arm: (): Armed => ({ kind: 'paintSurface', surface: null, label: 'Apagar superfície' }) },
      ],
    },
    {
      key: 'objects', title: 'Objetos de mapa',
      entries: Object.values(catalog.objects).map((o) => ({
        id: o.id, name: o.name, version: o.version, tags: o.tags,
        meta: `PV ${o.hp ?? '∞'} · ${o.material}${o.explosion ? ` · explode ${o.explosion.damage}` : ''}${o.interaction ? ` · ${o.interaction.kind}` : ''}`,
        arm: (): Armed => ({ kind: 'placeObject', defId: o.id, label: `Colocar ${o.name} (EDIT)` }),
      })),
    },
    {
      key: 'terrain', title: 'Terrenos (EDIT)',
      entries: [
        ...(['ground', 'wall', 'void', 'dark'] as const).map((t): Entry => ({
          id: `terrain.${t}`, name: { ground: 'Chão', wall: 'Parede', void: 'Vazio', dark: 'Área escura (alternar)' }[t], tags: [], meta: 'edita a preparação e reinicia a timeline',
          arm: (): Armed => ({ kind: 'paintTerrain', terrain: t, label: `Pintar terreno: ${t}` }),
        })),
        { id: 'edit.erase', name: 'Remover entidade', tags: [], meta: 'remove unidades/objetos da célula', arm: (): Armed => ({ kind: 'erase', label: 'Remover entidade' }) },
      ],
    },
    {
      key: 'mechanics', title: 'Mecânicas',
      entries: [
        { id: 'mech.end_turn', name: 'End Turn', tags: [], meta: 'encerra o turno ativo', arm: () => { const a = state().turn.activeUnitId; if (a) exec({ type: 'END_TURN', actorId: a }); } },
        { id: 'mech.defend', name: 'Defender', tags: [], meta: '1 PA · barreira 6', arm: () => { const a = actor(); if (a) exec({ type: 'DEFEND', actorId: a.id }); } },
        { id: 'mech.measure', name: 'Check Line of Sight / Calculate Path', tags: [], meta: 'clique origem e destino', arm: (): Armed => ({ kind: 'measure', label: 'Medir LOS/caminho' }) },
        { id: 'mech.ignite', name: 'Ignite Cell', tags: [], meta: 'emitStimulus heat', arm: (): Armed => ({ kind: 'effect', definitionId: 'debug.ignite', label: 'Ignite Cell', effects: [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'heat' }] }) },
        { id: 'mech.extinguish', name: 'Extinguish Cell', tags: [], meta: 'emitStimulus water', arm: (): Armed => ({ kind: 'effect', definitionId: 'debug.extinguish', label: 'Extinguish Cell', effects: [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'water' }] }) },
      ],
    },
  ];
}

function effectForm(): HTMLElement {
  return h('div', { class: 'form' },
    h('label', {}, 'Amount ', h('input', { type: 'number', value: String(ui.form.amount), onchange: (e: Event) => { ui.form.amount = Number((e.target as HTMLInputElement).value); refresh(); } })),
    h('label', {}, 'Damage Type ', h('select', { onchange: (e: Event) => { ui.form.damageType = (e.target as HTMLSelectElement).value as DamageType; refresh(); } },
      ...DAMAGE_TYPES.map((t) => h('option', { value: t, selected: t === ui.form.damageType }, t)))),
    h('label', {}, h('input', { type: 'checkbox', checked: ui.form.ignoreArmor, onchange: () => { ui.form.ignoreArmor = !ui.form.ignoreArmor; refresh(); } }), 'Ignore Armor'),
    h('label', {}, 'Status ', h('select', { onchange: (e: Event) => { ui.form.statusId = (e.target as HTMLSelectElement).value; refresh(); } },
      ...Object.keys(catalog.statuses).map((s) => h('option', { value: s, selected: s === ui.form.statusId }, s)))),
  );
}

function renderSidebar(): void {
  const q = ui.search.toLowerCase();
  const match = (e: Entry) => !q || [e.id, e.name, e.meta, ...e.tags].some((t) => t.toLowerCase().includes(q));
  const searchBox = h('input', {
    class: 'search', placeholder: 'Buscar conteúdo... (nome, id, tag)', value: ui.search,
    oninput: (e: Event) => { ui.search = (e.target as HTMLInputElement).value; renderSidebar(); (sidebar.querySelector('.search') as HTMLInputElement)?.focus(); },
  });
  const cats = sidebarCategories().map((cat) => {
    const entries = cat.entries.filter(match);
    if (q && entries.length === 0) return null;
    const open = !ui.collapsed.has(cat.key) || !!q;
    return h('div', { class: 'category' },
      h('div', { class: 'cat-title', onclick: () => { ui.collapsed.has(cat.key) ? ui.collapsed.delete(cat.key) : ui.collapsed.add(cat.key); renderSidebar(); } },
        `${open ? '▾' : '▸'} ${cat.title}`, h('span', { class: 'count' }, String(entries.length))),
      open ? cat.extra ?? null : null,
      ...(open ? entries.map((e) =>
        h('div', { class: 'entry', title: e.meta },
          h('div', { class: 'entry-head' }, h('b', {}, e.name), h('code', {}, e.id), e.version ? h('span', { class: 'ver' }, `v${e.version}`) : null),
          h('div', { class: 'meta' }, e.meta),
          e.tags.length ? h('div', { class: 'tags' }, ...e.tags.map((t) => h('span', {}, t))) : null,
          e.arm ? h('button', { onclick: () => { const r = e.arm!(); ui.armed = r ?? null; refresh(); } }, 'USAR') : null,
        )) : []),
    );
  });
  sidebar.replaceChildren(h('div', { class: 'side-title' }, 'CONTENT'), searchBox, ...cats.filter((c): c is HTMLDivElement => !!c));
}

// ---------------------------------------------------------------------------
// Inspector / logs
// ---------------------------------------------------------------------------

function kv(label: string, value: unknown): HTMLElement {
  return h('div', { class: 'kv' }, h('span', {}, label), h('b', {}, typeof value === 'string' ? value : JSON.stringify(value)));
}

function unitEvents(unitId: string): GameEvent[] {
  return ui.session.visibleEvents.filter((e) => e.payload.unitId === unitId || e.payload.targetId === unitId);
}

function renderUnitInspector(u: Unit): HTMLElement[] {
  const out: HTMLElement[] = [
    h('h3', {}, `${u.flags.isDummy ? 'TEST DUMMY' : catalog.classes[u.classId ?? '']?.name ?? ''} — ${u.id}`),
    kv('Equipe', u.team), kv('Posição', fmtCoord(u.pos)), kv('Vivo', u.alive),
    kv('Visto por', seenBy(u)), kv('Oculto', isHidden(u) ? 'sim' : 'não'),
    kv('PV', `${u.hp} / ${u.maxHp}`), kv('PA', `${u.ap} / ${u.maxAp}`), kv('PM', `${u.mp} / ${u.maxMp}`), kv('Foco', `${u.focus} / ${u.maxFocus}`),
    kv('Armadura', u.armor), kv('Resistências', u.resistances), kv('Barreira', u.shield ? `${u.shield.amount} (expira no turno próprio ${u.shield.expiresAtOwnTurn})` : 0),
    kv('Turnos próprios', u.ownTurnsStarted),
    kv('Estados', u.statuses.map((s) => `${s.statusId}(${s.remaining}${s.pendingStart ? ', pendente' : ''})`).join(', ') || '—'),
    kv('Recargas', Object.entries(u.availableFromOwnTurn).filter(([, t]) => t > u.ownTurnsStarted).map(([id, t]) => `${id} → turno ${t}`).join(', ') || '—'),
  ];
  if (!u.flags.isDummy) out.push(kv('Armas', u.weapons.join(', ')), kv('Habilidades', u.abilities.join(', ')), kv('Consumíveis', u.consumables.join(', ') || '—'));

  // Ações rápidas (mesmas operações do core)
  const quick = (label: string, effects: EffectOp[]) =>
    h('button', { onclick: () => { exec({ type: 'DEBUG_APPLY_EFFECTS', definitionId: `debug.quick`, target: { kind: 'entity', id: u.id }, effects }); refresh(); } }, label);
  out.push(h('h4', {}, 'QUICK ACTIONS'), h('div', { class: 'quick' },
    quick(`Deal ${ui.form.amount} ${ui.form.damageType}`, [{ op: 'damage', selector: 'targetCellOccupants', amount: ui.form.amount, damageType: ui.form.damageType, ignoreArmor: ui.form.ignoreArmor }]),
    quick(`Heal ${ui.form.amount}`, [{ op: 'heal', selector: 'targetCellOccupants', amount: ui.form.amount }]),
    quick(`Add Shield ${ui.form.amount}`, [{ op: 'grantShield', selector: 'targetCellOccupants', amount: ui.form.amount, ownTurns: 1 }]),
    quick(`Apply ${ui.form.statusId}`, [{ op: 'applyStatus', selector: 'targetCellOccupants', statusId: ui.form.statusId }]),
    quick('Ignite Cell', [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'heat' }]),
    quick('Extinguish', [{ op: 'emitStimulus', selector: 'targetCell', stimulus: 'water' }]),
    quick('Kill', [{ op: 'damage', selector: 'targetCellOccupants', amount: 9999, damageType: 'physical', ignoreArmor: true }]),
    h('button', { onclick: () => { exec({ type: 'DEBUG_SET_UNIT', unitId: u.id, patch: { hp: u.maxHp } }); refresh(); } }, 'RESET HP'),
    u.flags.isDummy ? h('button', { onclick: () => { exec({ type: 'DEBUG_RESET_DUMMY', unitId: u.id }); refresh(); } }, 'FULL RESET') : null,
  ));

  // Logs instrumentados derivados dos eventos do core
  const events = unitEvents(u.id);
  const damage = events.filter((e) => e.type === 'DAMAGE_APPLIED');
  const heals = events.filter((e) => e.type === 'HEALED');
  const shields = events.filter((e) => e.type === 'SHIELD_GRANTED');
  const statuses = events.filter((e) => e.type.startsWith('STATUS_'));
  const mechanics = events.filter((e) => ['FORCED_MOVE', 'SURFACE_EXPOSURE', 'MOVE_BLOCKED', 'UNIT_MOVED', 'UNIT_DEFEATED'].includes(e.type));
  const sum = (list: GameEvent[], key: string) => list.reduce((acc, e) => acc + Number(e.payload[key] ?? 0), 0);
  out.push(
    h('h4', {}, 'TEST SUMMARY'),
    h('div', { class: 'summary' },
      kv('Damage Received', sum(damage, 'hpDamage')), kv('Total Raw Damage', sum(damage, 'raw')), kv('Total Mitigated', sum(damage, 'mitigated')),
      kv('Shield Absorbed', sum(damage, 'shieldAbsorbed')), kv('Largest Hit', Math.max(0, ...damage.map((e) => Number(e.payload.raw)))),
      kv('Hits Received', damage.length), kv('Healing Received', sum(heals, 'effective')), kv('Overheal', sum(heals, 'overheal')),
      kv('Shield Generated', sum(shields.filter((e) => e.payload.applied), 'granted')),
      kv('Statuses Applied', statuses.filter((e) => e.type === 'STATUS_APPLIED').length),
      kv('Statuses Removed', statuses.filter((e) => e.type === 'STATUS_REMOVED' || e.type === 'STATUS_EXPIRED').length),
      kv('Forced Moves', mechanics.filter((e) => e.type === 'FORCED_MOVE').length),
      kv('Surface Triggers', mechanics.filter((e) => e.type === 'SURFACE_EXPOSURE' && e.payload.applied).length),
    ),
    logBlock('DAMAGE LOG', damage, (e) =>
      `#${e.seq} ${e.cause.sourceId ?? '—'} ${e.cause.definitionId ?? ''}\n raw ${e.payload.raw} ${String(e.payload.damageType).toUpperCase()} · mit ${e.payload.mitigated} · escudo ${e.payload.shieldAbsorbed} · PV −${e.payload.hpDamage}\n HP ${e.payload.hpBefore} → ${e.payload.hpAfter}`),
    logBlock('HEAL LOG', heals, (e) => `#${e.seq} ${e.cause.definitionId ?? ''} pedido ${e.payload.requested} · efetivo ${e.payload.effective} · overheal ${e.payload.overheal}\n HP ${e.payload.hpBefore} → ${e.payload.hpAfter}`),
    logBlock('SHIELD LOG', shields, (e) => `#${e.seq} ${e.cause.definitionId ?? ''} concedido ${e.payload.granted} · anterior ${e.payload.previous} · atual ${e.payload.current}${e.payload.applied ? '' : ' (ignorado: barreira mais forte)'}`),
    logBlock('STATUS LOG', statuses, (e) => `#${e.seq} ${e.type.replace('STATUS_', '')} ${e.payload.statusId}${e.payload.reason ? ` · motivo ${e.payload.reason}` : ''}${e.payload.damage ? ` · dano ${e.payload.damage}` : ''}${e.payload.remaining !== undefined ? ` · restante ${e.payload.remaining}` : ''}`),
    logBlock('MECHANICS LOG', mechanics, (e) => `#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`),
  );
  return out;
}

function logBlock(title: string, events: GameEvent[], fmt: (e: GameEvent) => string): HTMLElement {
  return h('details', { open: events.length > 0 && events.length < 8 },
    h('summary', {}, `${title} (${events.length})`),
    h('pre', { class: 'log' }, events.slice(-30).map(fmt).join('\n') || '—'));
}

/** Elementos da célula, cada um com botão para removê-lo (registrado na timeline). */
function cellElements(s: GameState, c: Coord): HTMLElement {
  const cell = getCell(s.map, c)!;
  const rows: HTMLElement[] = [];
  if (cell.surface) {
    rows.push(h('div', { class: 'elem' }, h('span', {}, `Superfície: ${cell.surface.kind}`),
      h('button', { class: 'remove', title: 'Remover a superfície desta célula',
        onclick: () => { exec({ type: 'DEBUG_PAINT_SURFACE', cells: [c], surface: null }); refresh(); } }, '✕ Remover')));
  }
  for (const e of entitiesAt(s, c)) {
    const label = e.entity === 'unit'
      ? `${e.flags.isDummy ? 'Boneco' : catalog.classes[e.classId ?? '']?.name ?? 'Personagem'}: ${e.id}`
      : `${catalog.objects[e.defId]?.name ?? e.defId}: ${e.id}`;
    rows.push(h('div', { class: 'elem' }, h('span', {}, label),
      h('button', { class: 'remove', title: `Remover ${e.id} do cenário`,
        onclick: () => {
          if (exec({ type: 'DEBUG_REMOVE_ENTITY', entityId: e.id }) && ui.selectedUnitId === e.id) ui.selectedUnitId = null;
          refresh();
        } }, '✕ Remover')));
  }
  return h('div', { class: 'elements' }, h('h4', {}, 'ELEMENTOS NA CÉLULA'), ...(rows.length ? rows : [h('div', { class: 'meta' }, 'Célula vazia')]));
}

/** Distância, linha de visão e caminho a partir do personagem selecionado. */
function cellInfoFromSelected(s: GameState, c: Coord, u: Unit | undefined): HTMLElement[] {
  if (!u || !u.alive || coordKey(u.pos) === coordKey(c)) return [];
  const d = Math.abs(u.pos.x - c.x) + Math.abs(u.pos.y - c.y) + 2 * Math.abs(u.pos.floor - c.floor);
  const los = lineOfSight(s, catalog, u.pos, c);
  const path = findPath(s, catalog, u.pos, c);
  const canMove = !!path && path.cost <= u.mp && entitiesAt(s, c).length === 0 && !u.flags.isDummy;
  const out: HTMLElement[] = [
    kv(`Distância a partir de ${u.id}`, d),
    kv('Linha de visão', los.visible ? 'sim' : `não (${los.reason}${los.blockedAt ? ' em ' + fmtCoord(los.blockedAt) : ''})`),
    kv('Caminho', path ? `${path.cost} PM (disponível ${u.mp})` : 'inexistente'),
  ];
  if (canMove) out.push(h('div', { class: 'msg' }, `Clique de novo nesta célula para mover ${u.id}`));
  return out;
}

function renderInspector(): void {
  const s = state();
  const parts: Array<HTMLElement | null> = [];
  if (ui.message) parts.push(h('div', { class: `msg ${ui.message.kind}` }, ui.message.text));
  if (ui.armed) {
    const painting = ui.armed.kind === 'paintSurface' || ui.armed.kind === 'paintTerrain';
    parts.push(h('div', { class: 'msg armed' }, `Ação armada: ${ui.armed.label} — clique no grid `,
      h('button', { onclick: () => { ui.armed = null; ui.measureFrom = null; refresh(); } }, painting ? 'Concluir pintura' : 'Cancelar')));
  }
  if (ui.measureInfo) parts.push(h('div', { class: 'msg' }, ui.measureInfo));

  const u = selectedUnit();

  if (ui.selectedCell) {
    const c = ui.selectedCell;
    const cell = getCell(s.map, c)!;
    parts.push(
      h('h3', {}, `Célula ${fmtCoord(c)}`),
      kv('Terreno', cell.terrain + (cell.dark ? ' (escura)' : '')),
      kv('Superfície', cell.surface?.kind ?? '—'),
      cell.surface ? kv('Origem', `${cell.surface.sourceDefinitionId ?? '—'} (${cell.surface.sourceId ?? '—'})`) : null,
      cell.surface ? kv('Criada / expira', `rodada ${cell.surface.createdRound} / ${cell.surface.expiresAtRound ?? 'nunca'}`) : null,
      kv('Custo de movimento', cell.surface ? catalog.surfaces[cell.surface.kind].enterCost : 1),
      kv('Ocupantes', entitiesAt(s, c).map((e) => e.id).join(', ') || 'nenhum'),
      ...cellInfoFromSelected(s, c, u),
      cellElements(s, c),
    );
    // Personagem/boneco na célula que não é o ator: mostrar os detalhes dele aqui.
    const occupant = unitAt(s, c);
    if (occupant && occupant.id !== u?.id) parts.push(...renderUnitInspector(occupant));
    for (const o of entitiesAt(s, c)) {
      if (o.entity !== 'object') continue;
      const def = catalog.objects[o.defId]!;
      parts.push(
        h('h3', {}, `Objeto ${o.id}`), kv('Definição', `${def.name} (${def.id} v${def.version})`),
        kv('PV', o.hp === null ? 'indestrutível' : `${o.hp} / ${o.maxHp}`), kv('Material', def.material), kv('Estado', o.state),
        kv('Em combustão', o.burning), kv('Tags', def.tags.join(' ')), kv('Usos restantes', o.usesLeft ?? '∞'),
        kv('Gatilhos', [def.explosion ? 'FIRE → EXPLODE' : null, def.explosion ? 'HP <= 0 → EXPLODE' : null, def.flammable && !def.explosion ? 'HEAT → COMBUSTION' : null].filter(Boolean).join(' · ') || '—'),
        def.interaction && u ? h('button', { onclick: () => { exec({ type: 'INTERACT', actorId: u.id, objectId: o.id }); refresh(); } }, `Interagir com ${u.id}`) : null,
      );
    }
  }

  if (u) {
    const onSelectedCell = !ui.selectedCell || coordKey(ui.selectedCell) === coordKey(u.pos);
    if (onSelectedCell) {
      parts.push(...renderUnitInspector(u));
    } else {
      // A célula clicada não é a do personagem: mostrar o ator recolhido e claramente separado.
      parts.push(h('details', { class: 'actor' },
        h('summary', {}, `Personagem selecionado (quem age): ${u.id} em ${fmtCoord(u.pos)}`),
        ...renderUnitInspector(u)));
    }
  }

  // Comparação de bonecos
  const dummies = Object.values(s.units).filter((x) => x.flags.isDummy);
  if (dummies.length > 1) {
    const last = ui.session.timeline[ui.session.cursor - 1];
    const rows = dummies.map((d) => {
      const e = last?.events.find((ev) => ev.type === 'DAMAGE_APPLIED' && ev.payload.targetId === d.id);
      return h('tr', {}, h('td', {}, d.id), h('td', {}, e ? String(e.payload.raw) : '—'), h('td', {}, e ? String(e.payload.mitigated) : '—'), h('td', {}, e ? String(e.payload.hpDamage) : '—'), h('td', {}, `${d.hp}/${d.maxHp}`));
    });
    parts.push(h('h4', {}, 'COMPARAÇÃO (último comando)'),
      h('table', { class: 'cmp' }, h('tr', {}, ...['', 'RAW', 'MITIG.', 'HP DMG', 'PV'].map((t) => h('th', {}, t))), ...rows));
  }

  parts.push(renderEventLog());
  inspector.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
}

function renderEventLog(): HTMLElement {
  const events = ui.session.visibleEvents;
  const selected = events.find((e) => e.seq === ui.selectedEventSeq);
  const list = h('div', { class: 'events' }, ...events.slice(-200).map((e) =>
    h('div', { class: `ev ${e.seq === ui.selectedEventSeq ? 'sel' : ''}`, onclick: () => { ui.selectedEventSeq = e.seq; renderInspector(); } },
      `#${String(e.seq).padStart(3, '0')} R${e.round} ${e.type}`)));
  queueMicrotask(() => { list.scrollTop = list.scrollHeight; });
  const detail = selected ? eventDetail(selected) : null;
  return h('div', {}, h('h4', {}, `GLOBAL EVENT LOG (${events.length})`), list, detail);
}

function eventDetail(e: GameEvent): HTMLElement {
  const entry = ui.session.timeline.find((t) => t.events.some((x) => x.seq === e.seq));
  return h('div', { class: 'detail' },
    kv('Evento', `#${e.seq} ${e.type}`), kv('Definição', e.cause.definitionId ?? '—'), kv('Origem', e.cause.sourceId ?? '—'),
    kv('Comando', e.cause.commandSeq ?? '—'), kv('Regras', `v${state().rulesVersion} / conteúdo ${state().contentVersion}`),
    h('pre', { class: 'log' }, JSON.stringify(e.payload, null, 1)),
    entry ? h('div', {}, h('h4', {}, 'STATE DIFF (comando inteiro)'), h('pre', { class: 'log' }, stateDiff(entry.before, entry.state).join('\n') || 'sem mudanças')) : null,
  );
}

function stateDiff(a: GameState, b: GameState): string[] {
  const out: string[] = [];
  for (const id of Object.keys(b.units)) {
    const x = a.units[id];
    const y = b.units[id]!;
    if (!x) continue;
    for (const k of ['hp', 'ap', 'mp', 'focus', 'alive'] as const) if (x[k] !== y[k]) out.push(`${id}.${k}: ${x[k]} → ${y[k]}`);
    if ((x.shield?.amount ?? 0) !== (y.shield?.amount ?? 0)) out.push(`${id}.shield: ${x.shield?.amount ?? 0} → ${y.shield?.amount ?? 0}`);
    if (coordKey(x.pos) !== coordKey(y.pos)) out.push(`${id}.pos: ${fmtCoord(x.pos)} → ${fmtCoord(y.pos)}`);
    const sx = x.statuses.map((s) => s.statusId).join(',');
    const sy = y.statuses.map((s) => s.statusId).join(',');
    if (sx !== sy) out.push(`${id}.statuses: [${sx}] → [${sy}]`);
  }
  for (const id of Object.keys(b.objects)) {
    const x = a.objects[id];
    const y = b.objects[id]!;
    if (x && (x.state !== y.state || x.hp !== y.hp || x.burning !== y.burning)) out.push(`${id}: ${x.state}/${x.hp}${x.burning ? '🔥' : ''} → ${y.state}/${y.hp}${y.burning ? '🔥' : ''}`);
  }
  for (let f = 0; f < b.map.floors; f++) for (let y = 0; y < b.map.height; y++) for (let x = 0; x < b.map.width; x++) {
    const c = { x, y, floor: f };
    const sa = getCell(a.map, c)?.surface?.kind ?? 'normal';
    const sb = getCell(b.map, c)?.surface?.kind ?? 'normal';
    if (sa !== sb) out.push(`surface ${fmtCoord(c)}: ${sa} → ${sb}`);
  }
  if (a.turn.round !== b.turn.round) out.push(`round: ${a.turn.round} → ${b.turn.round}`);
  if (a.turn.activeUnitId !== b.turn.activeUnitId) out.push(`turno: ${a.turn.activeUnitId} → ${b.turn.activeUnitId}`);
  return out;
}

// ---------------------------------------------------------------------------
// Timeline / STEP / REPLAY / TEST
// ---------------------------------------------------------------------------

function describeCommand(c: Command): string {
  switch (c.type) {
    case 'MOVE': return `${c.actorId} → ${fmtCoord(c.to)}`;
    case 'USE_ABILITY': return `${c.actorId} ${c.abilityId} @ ${JSON.stringify(c.target)}`;
    case 'BASIC_ATTACK': return `${c.actorId} ${c.weaponId} @ ${JSON.stringify(c.target)}`;
    case 'DEBUG_APPLY_EFFECTS': return `${c.definitionId ?? ''} ${c.effects.map((e) => e.op).join('+')} @ ${JSON.stringify(c.target)}`;
    case 'DEBUG_PAINT_SURFACE': return `${c.surface ?? 'apagar'} × ${c.cells.length}`;
    default: return 'actorId' in c ? c.actorId : '';
  }
}

function renderTimeline(): void {
  const t = ui.session;
  const entries = t.timeline.map((entry, i) =>
    h('div', { class: `tl ${i < t.cursor ? 'applied' : 'future'} ${i === t.cursor - 1 ? 'current' : ''}`, onclick: () => { t.cursor = i + 1; refresh(); } },
      h('b', {}, `${String(i).padStart(2, '0')} ${entry.command.type}`), ' ', describeCommand(entry.command),
      Object.keys(entry.options).length ? h('span', { class: 'pill danger' }, 'debug') : null,
      h('span', { class: 'count' }, `${entry.events.length} ev`)));
  const list = h('div', { class: 'tl-list' }, ...entries);
  queueMicrotask(() => { list.scrollLeft = list.scrollWidth; });
  const timelineNodes = [
    h('div', { class: 'tl-controls' },
      h('button', { onclick: () => { t.cursor = Math.min(1, t.timeline.length); refresh(); }, title: 'Início' }, '⏮'),
      h('button', { onclick: () => { t.stepBack(); refresh(); }, title: 'STEP ◀ (←)' }, '◀'),
      h('button', { onclick: () => { t.stepForward(); refresh(); }, title: 'STEP ▶ (→)' }, '▶'),
      h('button', { onclick: () => { t.cursor = t.timeline.length; refresh(); }, title: 'Fim' }, '⏭'),
      h('button', { onclick: () => { const r = t.replay(); ui.message = { text: r.identical ? 'REPLAY: estados idênticos (determinístico)' : 'REPLAY: DIVERGÊNCIA detectada', kind: r.identical ? 'ok' : 'error' }; refresh(); } }, 'REPLAY ✓'),
      h('button', {
        onclick: () => {
          const name = prompt('Nome do cenário (ex.: surfaces/oil_ignition)', 'lab/novo_cenario') ?? '';
          if (!name) return;
          const files = t.exportTest(name);
          const base = name.replaceAll('/', '__');
          download(`${base}.initial.json`, files.initial);
          download(`${base}.commands.json`, files.commands);
          download(`${base}.expected.json`, files.expected);
          ui.message = { text: `Exportado. Mova para tests/scenarios/${name}/ como initial.json, commands.json e expected.json.`, kind: 'ok' };
          refresh();
        },
      }, 'GERAR TESTE'),
      h('button', { onclick: () => { ui.session = new LabSession(catalog, defaultScenario); ui.message = null; refresh(); } }, 'Reiniciar cenário'),
      h('label', { class: 'btn' }, 'Importar initial.json', h('input', {
        type: 'file', accept: '.json', style: 'display:none',
        onchange: async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          try {
            ui.session = new LabSession(catalog, JSON.parse(await file.text()));
            ui.message = { text: `Cenário ${file.name} carregado`, kind: 'ok' };
          } catch (err) {
            ui.message = { text: String(err), kind: 'error' };
          }
          refresh();
        },
      })),
      h('span', { class: 'count' }, `cursor ${t.cursor}/${t.timeline.length}`),
    ),
    list,
  ];

  const tab = (key: typeof ui.bottomTab, label: string) =>
    h('button', { class: `tab ${ui.bottomTab === key ? 'on' : ''}`, onclick: () => { ui.bottomTab = key; renderTimeline(); } }, label);
  timeline.replaceChildren(
    h('div', { class: 'tabs' }, tab('actions', 'Ações'), tab('timeline', `Timeline (${t.cursor}/${t.timeline.length})`), tab('legend', 'Legenda')),
    h('div', { class: 'tab-body' }, ...(ui.bottomTab === 'actions' ? renderActionsPanel() : ui.bottomTab === 'legend' ? [legendPanel] : timelineNodes)),
  );
}

// ---------------------------------------------------------------------------
// Aba de ações: disponíveis e indisponíveis (calculadas pelo core)
// ---------------------------------------------------------------------------

function renderActionsPanel(): HTMLElement[] {
  const s = state();
  const options = EXEC_OPTIONS[ui.execMode];
  const a = actor();
  const c = ui.selectedCell;
  const targetEntity = c ? entitiesAt(s, c).find((e) => e.id !== a?.id) : undefined;
  const sections: HTMLElement[] = [];

  if (a && !a.flags.isDummy) {
    sections.push(actionSection(`Ações de ${a.id}`, listUnitActions(s, catalog, a.id, options), null));
  } else {
    sections.push(h('div', { class: 'meta' }, 'Selecione um personagem para ver as ações dele.'));
  }
  if (a && !a.flags.isDummy && targetEntity) {
    const label = targetEntity.entity === 'object' ? catalog.objects[targetEntity.defId]?.name ?? targetEntity.id : targetEntity.id;
    sections.push(actionSection(`${a.id} sobre ${label} (${targetEntity.id})`, listActionsOnTarget(s, catalog, a.id, targetEntity.id, options), targetEntity.id));
  }
  return [h('div', { class: 'action-sections' }, ...sections)];
}

function actionSection(title: string, actions: ActionInfo[], targetId: string | null): HTMLElement {
  const available = actions.filter((x) => x.available);
  const unavailable = actions.filter((x) => !x.available);
  const card = (x: ActionInfo) =>
    h('button', {
      class: `action ${x.available ? 'ok' : 'blocked'}`,
      disabled: !x.available,
      title: x.reason ? `${x.reason.code}: ${x.reason.message}` : x.id,
      onclick: () => runAction(x),
    },
      h('b', {}, x.name),
      h('span', { class: 'cost' }, x.cost),
      x.available
        ? h('span', { class: 'hint' }, x.command ? (targetId ? 'clique para executar' : 'executa agora') : `escolha o alvo${x.validTargets !== undefined ? ` · ${x.validTargets} válidos` : ''}`)
        : h('span', { class: 'why' }, x.reason?.message ?? ''));
  return h('div', { class: 'action-section' },
    h('h4', {}, title),
    actions.length === 0 ? h('div', { class: 'meta' }, 'Nenhuma ação.') : null,
    available.length ? h('div', { class: 'action-group' }, h('span', { class: 'group-label ok' }, `Disponíveis (${available.length})`), ...available.map(card)) : null,
    unavailable.length ? h('div', { class: 'action-group' }, h('span', { class: 'group-label blocked' }, `Indisponíveis (${unavailable.length})`), ...unavailable.map(card)) : null,
  );
}

function runAction(x: ActionInfo): void {
  if (x.command) {
    exec(x.command);
  } else if (x.kind === 'move') {
    ui.message = { text: 'Clique numa célula destacada em azul e clique de novo para mover.', kind: 'ok' };
  } else if (x.kind === 'attack') {
    ui.armed = { kind: 'attack', weaponId: x.id, label: x.name };
  } else if (x.kind === 'ability') {
    ui.armed = { kind: 'ability', abilityId: x.id, label: x.name };
  } else if (x.kind === 'item') {
    ui.armed = { kind: 'useItem', itemId: x.id, label: x.name };
  }
  refresh();
}

// ---------------------------------------------------------------------------

function rangePreview(): { min: number; max: number } | null {
  if (!ui.layers.attackRange || !ui.armed) return null;
  if (ui.armed.kind === 'ability') {
    const t = catalog.abilities[ui.armed.abilityId]?.target;
    return t?.range !== undefined ? { min: t.minRange ?? 0, max: t.range } : null;
  }
  if (ui.armed.kind === 'attack') {
    const w = catalog.items[ui.armed.weaponId];
    return w?.kind === 'weapon' && w.target.range !== undefined ? { min: w.target.minRange ?? 0, max: w.target.range } : null;
  }
  return null;
}

function drawGrid(): void {
  // Visão de equipe: desenha a projeção que aquele lado receberia do servidor.
  const projection = ui.visionTeam ? projectStateForTeam(state(), catalog, ui.visionTeam) : null;
  render(g, {
    state: projection?.state ?? state(), catalog, floor: ui.floor, layers: ui.layers,
    selectedCell: ui.selectedCell, selectedUnitId: ui.selectedUnitId, hoverCell: ui.hoverCell, rangePreview: rangePreview(),
  });
  if (projection) {
    const { width, height } = state().map;
    g.fillStyle = 'rgba(5, 6, 10, 0.62)';
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!projection.vision.visibleCells.has(coordKey({ x, y, floor: ui.floor }))) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function teamsInMatch(): string[] {
  return [...new Set(Object.values(state().units).filter((u) => !u.flags.isDummy).map((u) => u.team))].sort();
}

/** Equipes inimigas que detectam a unidade agora. */
function seenBy(u: Unit): string {
  const teams = teamsInMatch().filter((t) => t !== u.team && teamDetects(state(), catalog, t, u));
  return teams.length ? teams.join(', ') : 'nenhuma equipe inimiga';
}

function refresh(): void {
  renderToolbar();
  renderSidebar();
  renderInspector();
  renderTimeline();
  drawGrid();
}

refresh();
