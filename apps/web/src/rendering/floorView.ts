/**
 * Tratamento visual de andares (seção 14.6): cada nó da cena é registrado no andar a que
 * pertence. Ao visualizar o andar N, tudo que está acima de N fica translúcido, não
 * projeta sombra e não é selecionável — apenas no cliente. As regras do core (visão,
 * movimento, projéteis) continuam tratando o piso como sólido.
 *
 * Opacidades de fantasma: estruturas (pisos, paredes, objetos) ficam quase invisíveis
 * (`GHOST_VISIBILITY`); personagens, seus efeitos, superfícies, partículas e rótulos HTML
 * usam o mesmo valor mais legível (`GHOST_ENTITY_VISIBILITY`), para que um personagem no
 * andar fantasma continue reconhecível e tudo que é dele tenha a mesma opacidade.
 *
 * `version` muda a cada troca de andar: quem compõe a visibilidade por cima do FloorView
 * (CameraOcclusion) reaplica o seu valor quando ela muda.
 */
import type { AbstractMesh, ShadowGenerator, TransformNode } from '@babylonjs/core';

/** Opacidade das estruturas acima do andar visualizado. */
export const GHOST_VISIBILITY = 0.12;
/** Opacidade de personagens, efeitos e rótulos acima do andar visualizado. */
export const GHOST_ENTITY_VISIBILITY = 0.35;

type Node = AbstractMesh | TransformNode;

export interface FloorRegistration {
  /** Opacidade quando fantasma (padrão: `GHOST_VISIBILITY`). */
  ghostVisibility?: number;
  /** Chamado após cada aplicação (o nó cuida de opacidades próprias, ex.: personagem). */
  onApply?: (ghost: boolean) => void;
}

export class FloorView {
  private readonly nodes = new Map<Node, { floor: number; opts?: FloorRegistration }>();
  private viewed: number;
  /** Incrementa a cada troca do andar visualizado. */
  version = 0;
  /** Ouvintes da troca de andar (HUD, câmera). */
  private readonly listeners: Array<(floor: number) => void> = [];

  constructor(
    readonly floors: number,
    private readonly shadows: ShadowGenerator | null,
  ) {
    this.viewed = floors - 1;
  }

  get viewedFloor(): number {
    return this.viewed;
  }

  /** Registra um nó (e seus descendentes) como pertencente a `floor`. */
  register(node: Node, floor: number, opts?: FloorRegistration): void {
    const prev = this.nodes.get(node);
    const o = opts ?? prev?.opts;
    this.nodes.set(node, { floor, opts: o });
    this.apply(node, floor, o);
  }

  /** Atualiza o andar de um nó já registrado (ex.: personagem que subiu a escada). */
  move(node: Node, floor: number): void {
    const cur = this.nodes.get(node);
    if (cur?.floor === floor) return;
    this.register(node, floor, cur?.opts);
  }

  /** Andar registrado de um nó (ou `undefined`). */
  floorOf(node: Node): number | undefined {
    return this.nodes.get(node)?.floor;
  }

  unregister(node: Node): void {
    this.nodes.delete(node);
  }

  onChange(fn: (floor: number) => void): void {
    this.listeners.push(fn);
  }

  setViewedFloor(floor: number): void {
    const f = Math.max(0, Math.min(this.floors - 1, floor));
    if (f === this.viewed) return;
    this.viewed = f;
    this.version++;
    for (const [node, { floor: nodeFloor, opts }] of this.nodes) this.apply(node, nodeFloor, opts);
    for (const fn of this.listeners) fn(f);
  }

  isGhost(floor: number): boolean {
    return floor > this.viewed;
  }

  /** Fator de opacidade de estruturas do andar (1 ou `GHOST_VISIBILITY`). */
  structureFactor(floor: number): number {
    return this.isGhost(floor) ? GHOST_VISIBILITY : 1;
  }

  /** Fator de opacidade de personagens/efeitos/rótulos do andar (1 ou `GHOST_ENTITY_VISIBILITY`). */
  entityFactor(floor: number): number {
    return this.isGhost(floor) ? GHOST_ENTITY_VISIBILITY : 1;
  }

  private apply(node: Node, floor: number, opts?: FloorRegistration): void {
    if (node.isDisposed()) {
      this.nodes.delete(node);
      return;
    }
    const ghost = this.isGhost(floor);
    const meshes: AbstractMesh[] = node.getChildMeshes(false);
    if ('getTotalVertices' in node) meshes.push(node as AbstractMesh);
    for (const m of meshes) {
      // Malhas marcadas como sempre ocultas (ex.: overlay de debug) não são tocadas.
      if (m.metadata?.floorViewIgnore) continue;
      // Malhas com opacidade própria (corpo do personagem, bolha da barreira…) só perdem picking/sombra.
      if (!m.metadata?.ownVisibility) m.visibility = ghost ? (opts?.ghostVisibility ?? GHOST_VISIBILITY) : 1;
      m.isPickable = !ghost && !m.metadata?.neverPickable;
      if (this.shadows && m.metadata?.castsShadow) {
        if (ghost) this.shadows.removeShadowCaster(m, false);
        else this.shadows.addShadowCaster(m, false);
      }
    }
    opts?.onApply?.(ghost);
  }
}
