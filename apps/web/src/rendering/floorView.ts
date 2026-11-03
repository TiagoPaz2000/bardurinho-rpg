/**
 * Tratamento visual de andares (seção 14.6): cada nó da cena é registrado no andar a que
 * pertence. Ao visualizar o andar N, tudo que está acima de N fica quase transparente,
 * não projeta sombra e não é selecionável — apenas no cliente. As regras do core (visão,
 * movimento, projéteis) continuam tratando o piso como sólido.
 */
import type { AbstractMesh, ShadowGenerator, TransformNode } from '@babylonjs/core';

/** Opacidade das estruturas acima do andar visualizado. */
const GHOST_VISIBILITY = 0.12;

type Node = AbstractMesh | TransformNode;

export class FloorView {
  private readonly nodes = new Map<Node, number>();
  private viewed: number;

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
  register(node: Node, floor: number): void {
    this.nodes.set(node, floor);
    this.apply(node, floor);
  }

  /** Atualiza o andar de um nó já registrado (ex.: personagem que subiu a escada). */
  move(node: Node, floor: number): void {
    if (this.nodes.get(node) === floor) return;
    this.register(node, floor);
  }

  unregister(node: Node): void {
    this.nodes.delete(node);
  }

  setViewedFloor(floor: number): void {
    const f = Math.max(0, Math.min(this.floors - 1, floor));
    if (f === this.viewed) return;
    this.viewed = f;
    for (const [node, nodeFloor] of this.nodes) this.apply(node, nodeFloor);
  }

  isGhost(floor: number): boolean {
    return floor > this.viewed;
  }

  private apply(node: Node, floor: number): void {
    const ghost = this.isGhost(floor);
    const meshes: AbstractMesh[] = node.getChildMeshes(false);
    if ('getTotalVertices' in node) meshes.push(node as AbstractMesh);
    for (const m of meshes) {
      // Malhas marcadas como sempre ocultas (ex.: overlay de debug) não são tocadas.
      if (m.metadata?.floorViewIgnore) continue;
      m.visibility = ghost ? GHOST_VISIBILITY : 1;
      m.isPickable = !ghost;
      if (this.shadows && m.metadata?.castsShadow) {
        if (ghost) this.shadows.removeShadowCaster(m, false);
        else this.shadows.addShadowCaster(m, false);
      }
    }
  }
}
