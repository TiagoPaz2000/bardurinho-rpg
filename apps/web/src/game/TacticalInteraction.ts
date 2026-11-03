/**
 * Interação com a arena (seções 14.5, 14.8 e 14.9): cursor, seleção, movimento e mira.
 *
 * Modo tático:
 * - Cursor: a cada quadro um raio a partir do ponteiro (rendering/picking.ts) acha a célula
 *   sob o mouse no andar visualizado (estruturas fantasmas não bloqueiam o raio). Uma
 *   entidade atingida conta como a célula dela.
 * - Clique esquerdo (sem arrastar): personagem → seleciona; célula/objeto → mostra no
 *   painel (com as ações possíveis sobre o objeto/personagem, `listActionsOnTarget`); se o
 *   personagem selecionado é o ativo e a célula está ao alcance → `MOVE`.
 * - Destaques do personagem ativo selecionado: alcance de movimento (`reachableCells` com
 *   os PM atuais, tom pelo custo) e, sob o cursor, o caminho (`findPath`) com o custo total.
 *
 * Modo de habilidade (mira), aberto pela barra de ações para ataques, habilidades e itens
 * com alvo:
 * - Células no alcance: verde = alvo válido, vermelho escuro = inválido (motivo do motor ao
 *   passar o cursor). Os destaques de movimento somem.
 * - Cursor sobre alvo válido: área afetada em amarelo (`previewArea`) e, para personagens,
 *   a chance de acerto (`previewTargets`); objetos: "acerto automático".
 * - Clique esquerdo confirma (`BASIC_ATTACK` / `USE_ABILITY` / `USE_ITEM`, alvo entidade
 *   quando se clica no personagem/objeto e o motor aceita; senão a célula). Esc ou clique
 *   direito (sem arrastar) cancela e volta ao modo tático. A câmera continua livre.
 * - Clique direito sem mira: limpa a seleção (Esc sem mira abre a tela de opções).
 *
 * Tudo aqui é prévia visual: o core recalcula e valida o comando (seção 14.8).
 */
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import {
  applyCommand,
  coordKey,
  findPath,
  getCell,
  listTargetCells,
  previewArea,
  previewTargets,
  reachableCells,
  sameCoord,
  targetedCommand,
  type ActionInfo,
  type Catalog,
  type CommandTarget,
  type Coord,
  type EntityId,
  type GameState,
  type GameplayCommand,
  type TargetCellInfo,
  type TargetedAction,
} from '@bardurinho/domain';
import type { ArenaView } from '../rendering/ArenaView.js';
import { CellHighlightLayer, type CellMark } from '../rendering/highlights.js';
import { cellToWorld, FLOOR_HEIGHT, worldToCell } from '../rendering/grid.js';
import { PALETTE } from '../rendering/materials.js';
import { pickAt, type PickResult } from '../rendering/picking.js';
import type { WorldLabels } from '../rendering/worldLabels.js';
import type { Inspected } from '../screens/hud.js';
import type { MatchDriver } from './MatchController.js';

/** Distância máxima (px) entre pointerdown e pointerup para contar como clique. */
const CLICK_SLOP = 6;
const PATH_LABEL = 'path-cost';
const AIM_LABEL = 'aim-hint';
const IDENTITY = Matrix.Identity();

export interface TacticalInteractionOptions {
  scene: Scene;
  canvas: HTMLCanvasElement;
  arena: ArenaView;
  match: MatchDriver;
  catalog: Catalog;
  labels: WorldLabels;
  /** Entrada manual do jogador (interrompe a câmera automática, seção 14.12). */
  onManualInput: () => void;
  /** Mudou o modo (tático ↔ habilidade) ou a ação mirada. */
  onModeChange?: () => void;
}

/** Ação em mira (modo de habilidade). */
export interface Aiming {
  action: TargetedAction;
  key: string;
  name: string;
  actorId: EntityId;
  cells: Map<string, TargetCellInfo>;
}

/** Interpola duas cores `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (p: number) => `${Math.round(p * 100)}%`;

export class TacticalInteraction {
  selectedUnitId: EntityId | null = null;
  inspected: Inspected | null = null;
  /** Célula sob o cursor (null fora do mapa). */
  hoverCell: Coord | null = null;
  /**
   * Célula de chão sob o cursor ignorando estruturas e objetos (raio × plano do andar
   * visualizado, depois os de baixo). Alvo da oclusão: o muro/porta na frente dela esmaece e
   * deixa de ser selecionável, então a célula logo atrás de uma porta ou muro fica clicável.
   */
  pointerFloorCell: Coord | null = null;
  /** Modo de habilidade ativo (null = modo tático). */
  aiming: Aiming | null = null;

  private readonly rangeLayer: CellHighlightLayer;
  private readonly pathLayer: CellHighlightLayer;
  private readonly hoverLayer: CellHighlightLayer;
  private readonly selectLayer: CellHighlightLayer;
  private readonly targetLayer: CellHighlightLayer;
  private readonly areaLayer: CellHighlightLayer;
  private pointer: { x: number; y: number } | null = null;
  private down: { x: number; y: number; button: number } | null = null;
  private reach: Map<string, { coord: Coord; cost: number }> | null = null;
  private lastHoverKey = '';
  private hoverPick: PickResult | null = null;

  constructor(private readonly o: TacticalInteractionOptions) {
    const { scene, arena } = o;
    this.rangeLayer = new CellHighlightLayer(scene, arena.floorView, 'range', { alpha: 0.42, order: 0 });
    this.targetLayer = new CellHighlightLayer(scene, arena.floorView, 'target', { alpha: 0.4, order: 0 });
    this.areaLayer = new CellHighlightLayer(scene, arena.floorView, 'area', { alpha: 0.62, order: 1, size: 1.5 });
    this.pathLayer = new CellHighlightLayer(scene, arena.floorView, 'path', { alpha: 0.75, order: 1, size: 1.3 });
    this.selectLayer = new CellHighlightLayer(scene, arena.floorView, 'selected', { alpha: 0.5, order: 2, size: 1.96 });
    this.hoverLayer = new CellHighlightLayer(scene, arena.floorView, 'hover', { alpha: 0.35, order: 3, size: 1.96 });

    const c = o.canvas;
    c.addEventListener('pointermove', (e) => (this.pointer = { x: e.offsetX, y: e.offsetY }));
    c.addEventListener('pointerleave', () => (this.pointer = null));
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) this.down = { x: e.offsetX, y: e.offsetY, button: e.button };
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.down || e.button !== this.down.button) return;
      const moved = Math.hypot(e.offsetX - this.down.x, e.offsetY - this.down.y);
      this.down = null;
      if (moved > CLICK_SLOP) return;
      if (e.button === 0) this.click(e.offsetX, e.offsetY);
      // Clique direito sem arrastar (arrastar = pan da câmera): cancela a mira.
      else if (this.aiming) this.cancelAiming();
      else this.clearSelection();
    });
    scene.onBeforeRenderObservable.add(() => this.updateHover());

    // Começa com o personagem ativo selecionado.
    this.selectUnit(o.match.activeUnit?.id ?? null);
  }

  private get state(): GameState {
    return this.o.match.state;
  }

  /** Personagem selecionado que pode receber ordens agora (é o da vez). */
  private get actorId(): EntityId | null {
    const id = this.selectedUnitId;
    const s = this.state;
    return id && s.status === 'active' && s.turn.activeUnitId === id && s.units[id]?.alive && this.o.match.canControl(id) ? id : null;
  }

  selectUnit(id: EntityId | null): void {
    this.selectedUnitId = id;
    this.inspected = id ? { kind: 'unit', id } : null;
    this.refresh();
  }

  clearSelection(): void {
    this.selectUnit(null);
  }

  // -------------------------------------------------------------------------
  // Modo de habilidade
  // -------------------------------------------------------------------------

  /** Entra no modo de habilidade com uma ação com alvo do personagem da vez. */
  startAiming(info: ActionInfo): boolean {
    const actorId = this.state.turn.activeUnitId;
    if (!actorId || this.o.match.busy || !this.o.match.canControl(actorId)) return false;
    if (info.kind !== 'attack' && info.kind !== 'ability' && info.kind !== 'item') return false;
    if (this.aiming?.key === info.key) {
      // Mesma ação de novo: alterna (sai da mira).
      this.cancelAiming();
      return false;
    }
    const action: TargetedAction = { kind: info.kind, id: info.id };
    const cells = new Map(listTargetCells(this.state, this.o.catalog, actorId, action).map((t) => [coordKey(t.cell), t]));
    // O personagem da vez passa a ser o selecionado (as ordens partem dele).
    this.selectedUnitId = actorId;
    this.inspected = { kind: 'unit', id: actorId };
    this.aiming = { action, key: info.key, name: info.name, actorId, cells };
    this.targetLayer.set(
      [...cells.values()].map((t) => ({ cell: t.cell, color: t.valid ? PALETTE.highlight.targetValid : PALETTE.highlight.targetInvalid })),
    );
    this.refresh();
    this.o.onModeChange?.();
    return true;
  }

  cancelAiming(): void {
    if (!this.aiming) return;
    this.aiming = null;
    this.targetLayer.clear();
    this.areaLayer.clear();
    this.o.labels.unpin(AIM_LABEL);
    this.refresh();
    this.o.onModeChange?.();
  }

  /** Alvo do comando: a entidade clicada (se o motor aceita) ou a célula. */
  private aimTarget(a: Aiming, cell: Coord, pick: PickResult | null): CommandTarget {
    if (pick?.kind === 'entity' && pick.entityId !== a.actorId) {
      const target: CommandTarget = { kind: 'entity', id: pick.entityId };
      if (applyCommand(this.state, this.o.catalog, targetedCommand(a.actorId, a.action, target)).ok) return target;
    }
    return { kind: 'cell', ...cell };
  }

  private async confirmAim(cell: Coord, pick: PickResult | null): Promise<void> {
    const a = this.aiming;
    if (!a) return;
    const info = a.cells.get(coordKey(cell));
    if (!info) return; // fora do alcance: ignora (a mira continua)
    const command = targetedCommand(a.actorId, a.action, this.aimTarget(a, cell, pick)) as GameplayCommand;
    // Inválida: o core recusa com o motivo (aviso no HUD); a mira continua.
    if (!info.valid) {
      await this.o.match.execute({ ...command, expectedTurnId: this.state.turn.turnId });
      return;
    }
    this.aiming = null;
    this.targetLayer.clear();
    this.areaLayer.clear();
    this.hoverLayer.clear();
    this.o.labels.unpin(AIM_LABEL);
    this.o.onModeChange?.();
    await this.o.match.execute({ ...command, expectedTurnId: this.state.turn.turnId });
    this.refresh();
  }

  /** Prévia sob o cursor no modo de habilidade: área (amarelo) e chance de acerto. */
  private updateAim(h: Coord | null): void {
    const a = this.aiming!;
    this.pathLayer.clear();
    this.o.labels.unpin(PATH_LABEL);
    const info = h ? a.cells.get(coordKey(h)) : undefined;
    if (!h) {
      this.hoverLayer.clear();
      this.areaLayer.clear();
      this.o.labels.unpin(AIM_LABEL);
      return;
    }
    this.hoverLayer.set([{ cell: h, color: info?.valid ? PALETTE.highlight.hover : PALETTE.highlight.invalid }]);
    const w = cellToWorld(h);
    const at = new Vector3(w.x, w.y + 0.9, w.z);
    if (!info) {
      this.areaLayer.clear();
      this.o.labels.unpin(AIM_LABEL);
      return;
    }
    if (!info.valid) {
      this.areaLayer.clear();
      this.o.labels.pinHtml(AIM_LABEL, `<b>${esc(a.name)}</b><br>${esc(info.reason?.message ?? 'Alvo inválido')}`, at, 'aim-hint invalid');
      return;
    }
    const area = previewArea(this.state, this.o.catalog, a.actorId, a.action, h);
    this.areaLayer.set(area.map((cell): CellMark => ({ cell, color: PALETTE.highlight.area })));
    const lines = previewTargets(this.state, this.o.catalog, a.actorId, a.action, h).map((t) => {
      const name = t.entity === 'unit' ? this.unitLabel(t.entityId) : (this.o.catalog.objects[this.state.objects[t.entityId]?.defId ?? '']?.name ?? t.entityId);
      return t.attackRoll
        ? `${esc(name)}: <b>chance de acerto ${pct(t.hitChance)}</b> <span class="sub">(d20 + ${t.attackBonus} vs Def ${t.defense})</span>`
        : `${esc(name)}: <b>acerto automático</b>`;
    });
    this.o.labels.pinHtml(AIM_LABEL, `<b>${esc(a.name)}</b>${lines.length ? `<br>${lines.join('<br>')}` : `<br><span class="sub">${area.length > 1 ? `área: ${area.length} células` : 'célula vazia'}</span>`}`, at, 'aim-hint');
  }

  /** Nome de exibição do personagem (a classe; os ids do cenário não são nomes). */
  private unitLabel(id: EntityId): string {
    const u = this.state.units[id];
    if (!u) return id;
    if (u.name && u.name !== u.id) return u.name;
    return u.classId ? (this.o.catalog.classes[u.classId]?.name ?? u.classId) : 'Boneco';
  }

  // -------------------------------------------------------------------------
  // Modo tático
  // -------------------------------------------------------------------------

  /** Recalcula os destaques a partir do estado atual (após sync ou mudança de seleção). */
  refresh(): void {
    const s = this.state;
    if (this.selectedUnitId && !s.units[this.selectedUnitId]?.alive) this.selectedUnitId = null;
    // A mira só vale para o personagem da vez no turno em que começou.
    if (this.aiming && (s.turn.activeUnitId !== this.aiming.actorId || s.status !== 'active')) {
      this.aiming = null;
      this.targetLayer.clear();
      this.areaLayer.clear();
      this.o.labels.unpin(AIM_LABEL);
      this.o.onModeChange?.();
    }
    const actor = this.actorId ? s.units[this.actorId]! : null;
    if (actor && !this.o.match.busy && !this.aiming) {
      this.reach = reachableCells(s, this.o.catalog, actor.pos, actor.mp);
      const max = Math.max(1, actor.mp);
      const marks: CellMark[] = [];
      for (const { coord, cost } of this.reach.values()) {
        if (cost === 0) continue;
        marks.push({ cell: coord, color: mix(PALETTE.highlight.rangeNear, PALETTE.highlight.rangeFar, (cost - 1) / Math.max(1, max - 1)) });
      }
      this.rangeLayer.set(marks);
    } else {
      this.reach = null;
      this.rangeLayer.clear();
    }

    // Paredes/vazio: só o painel (a placa ficaria dentro da parede).
    const selCell = this.inspectedCell();
    if (selCell && getCell(s.map, selCell)?.terrain === 'ground') this.selectLayer.set([{ cell: selCell, color: PALETTE.highlight.selected }]);
    else this.selectLayer.clear();

    this.lastHoverKey = '';
    this.updatePath();
  }

  private inspectedCell(): Coord | null {
    const i = this.inspected;
    if (!i) return null;
    if (i.kind === 'cell') return i.cell;
    const e = i.kind === 'unit' ? this.state.units[i.id] : this.state.objects[i.id];
    return e?.pos ?? null;
  }

  private cellOf(pick: PickResult | null): Coord | null {
    if (!pick) return null;
    if (pick.kind === 'cell') return pick.cell;
    const e = pick.entity === 'unit' ? this.state.units[pick.entityId] : this.state.objects[pick.entityId];
    return e?.pos ?? null;
  }

  private floorCellUnderPointer(): Coord | null {
    const cam = this.o.scene.activeCamera;
    if (!this.pointer || !cam) return null;
    const ray = this.o.scene.createPickingRay(this.pointer.x, this.pointer.y, IDENTITY, cam);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const map = this.state.map;
    for (let floor = this.o.arena.floorView.viewedFloor; floor >= 0; floor--) {
      const t = (floor * FLOOR_HEIGHT - ray.origin.y) / ray.direction.y;
      if (t <= 0) continue;
      const p = ray.origin.add(ray.direction.scale(t));
      const c = worldToCell({ x: p.x, y: p.y, z: p.z }, map, floor);
      if (c && getCell(map, c)?.terrain === 'ground') return c;
    }
    return null;
  }

  private updateHover(): void {
    this.pointerFloorCell = this.o.match.busy ? null : this.floorCellUnderPointer();
    const pick = this.pointer ? pickAt(this.o.scene, this.state.map, this.pointer.x, this.pointer.y) : null;
    this.hoverPick = pick;
    this.hoverCell = this.o.match.busy ? null : this.cellOf(pick);
    const key = this.hoverCell ? coordKey(this.hoverCell) : '';
    if (key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    this.updatePath();
  }

  /** Cursor + prévia do caminho (modo tático) ou da mira (modo de habilidade). */
  private updatePath(): void {
    const h = this.hoverCell;
    if (this.o.match.busy) {
      this.hoverLayer.clear();
      this.pathLayer.clear();
      this.areaLayer.clear();
      this.o.labels.unpin(PATH_LABEL);
      this.o.labels.unpin(AIM_LABEL);
      return;
    }
    if (this.aiming) {
      this.updateAim(h);
      return;
    }
    const actor = this.actorId ? this.state.units[this.actorId] : undefined;
    const reachable = h && this.reach?.get(coordKey(h));
    if (!h) {
      this.hoverLayer.clear();
      this.pathLayer.clear();
      this.o.labels.unpin(PATH_LABEL);
      return;
    }
    // Cursor: branco; vermelho quando há um personagem pronto para mover e a célula não é alcançável.
    const blocked = actor && !reachable && !sameCoord(h, actor.pos) && getCell(this.state.map, h)?.terrain === 'ground';
    this.hoverLayer.set([{ cell: h, color: blocked ? PALETTE.highlight.invalid : PALETTE.highlight.hover }]);

    if (actor && reachable && reachable.cost > 0) {
      const path = findPath(this.state, this.o.catalog, actor.pos, h, { maxCost: actor.mp });
      if (path) {
        this.pathLayer.set(path.path.slice(1).map((c) => ({ cell: c, color: PALETTE.highlight.path })));
        const w = cellToWorld(h);
        this.o.labels.pin(PATH_LABEL, `${path.cost} PM`, new Vector3(w.x, w.y + 0.9, w.z), 'path-cost');
        return;
      }
    }
    this.pathLayer.clear();
    this.o.labels.unpin(PATH_LABEL);
  }

  private click(x: number, y: number): void {
    this.o.onManualInput();
    if (this.o.match.busy) return;
    const pick = pickAt(this.o.scene, this.state.map, x, y);
    if (this.aiming) {
      const cell = this.cellOf(pick);
      if (cell) void this.confirmAim(cell, pick);
      return;
    }
    if (!pick) return;

    if (pick.kind === 'entity' && pick.entity === 'unit') {
      this.selectUnit(pick.entityId);
      return;
    }
    const cell = this.cellOf(pick);
    if (!cell) return;
    const actorId = this.actorId;
    const reachable = actorId ? this.reach?.get(coordKey(cell)) : undefined;
    // Clique no chão de uma célula com objeto (ex.: a porta esmaecida pela oclusão deixa o raio
    // passar até o piso): inspeciona o objeto, para as ações sobre ele continuarem à mão.
    const objectHere = pick.kind === 'cell' ? Object.values(this.state.objects).find((o) => o.state !== 'destroyed' && sameCoord(o.pos, cell)) : undefined;
    this.inspected = pick.kind === 'entity' ? { kind: 'object', id: pick.entityId } : objectHere ? { kind: 'object', id: objectHere.id } : { kind: 'cell', cell };
    if (actorId && reachable && reachable.cost > 0) {
      void this.move(actorId, cell);
      return;
    }
    // Sem ordem possível: só inspeciona (o personagem continua selecionado).
    this.refresh();
  }

  /** Depuração/testes: o que está sob o cursor. */
  get hovered(): PickResult | null {
    return this.hoverPick;
  }

  private async move(actorId: EntityId, to: Coord): Promise<void> {
    // Esconde as prévias durante a animação; o core decide o caminho real.
    this.rangeLayer.clear();
    this.pathLayer.clear();
    this.hoverLayer.clear();
    this.o.labels.unpin(PATH_LABEL);
    await this.o.match.execute({ type: 'MOVE', actorId, to, expectedTurnId: this.state.turn.turnId });
    // Após o movimento o painel mostra o personagem (PM atualizados).
    if (this.selectedUnitId === actorId) this.inspected = { kind: 'unit', id: actorId };
    this.refresh();
  }
}
