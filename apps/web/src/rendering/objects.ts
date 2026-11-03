/**
 * Objetos do mapa como primitivas provisórias (seção 6.1 / fase-02-modelos-3d.md §4),
 * com uma cor por `defId`. O visual só reflete `MapObject.state`; trocar por GLBs
 * depois não muda a interface (`ObjectView.update`).
 */
import { Color3, MeshBuilder, TransformNode, Vector3, type AbstractMesh, type Mesh, type Scene } from '@babylonjs/core';
import { getCell, type GameMap, type MapObject } from '@bardurinho/domain';
import { easeInOut, easeOut, hash, rand, tween } from './anim.js';
import { CELL_SIZE, cellToWorld } from './grid.js';
import type { ModelLibrary } from './loaders.js';
import { PALETTE, type Materials } from './materials.js';

const BASE_PLATE_URL = '/models/environment/ornate_circular_base_plate.glb';
const BURNING_TINT = new Color3(1, 0.45, 0.1);

export interface ObjectViewContext {
  scene: Scene;
  map: GameMap;
  mats: Materials;
  models: ModelLibrary;
  /** Chamado para cada malha criada (sombras, metadados). */
  onMesh: (mesh: AbstractMesh, castsShadow: boolean) => void;
}

export class ObjectView {
  readonly root: TransformNode;
  /** Partes que mudam com o estado. */
  private readonly parts: Record<string, TransformNode | Mesh> = {};
  private lastState: string | null = null;
  /** Destroços (barril, caixote, porta destruídos). */
  private debris: TransformNode | null = null;
  /** Resolve quando os modelos assíncronos (GLB) do objeto terminam de carregar. */
  ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly ctx: ObjectViewContext,
    readonly id: string,
    readonly defId: string,
    obj: MapObject,
  ) {
    this.root = new TransformNode(`object:${id}`, ctx.scene);
    this.root.metadata = { entityId: id, entity: 'object' };
    this.place(obj);
    this.build(obj);
    this.update(obj);
  }

  private place(obj: MapObject): void {
    const w = cellToWorld(obj.pos);
    this.root.position.set(w.x, w.y, w.z);
  }

  private box(name: string, size: { w: number; h: number; d: number }, hex: string, pos: [number, number, number], parent: TransformNode = this.root, emissive = 0): Mesh {
    const m = MeshBuilder.CreateBox(`${this.id}:${name}`, { width: size.w, height: size.h, depth: size.d }, this.ctx.scene);
    m.material = this.ctx.mats.solid(hex, { emissive });
    m.position.set(...pos);
    m.parent = parent;
    this.ctx.onMesh(m, true);
    return m;
  }

  private cyl(name: string, d: number, h: number, hex: string, pos: [number, number, number], parent: TransformNode = this.root, emissive = 0, tess = 20): Mesh {
    const m = MeshBuilder.CreateCylinder(`${this.id}:${name}`, { diameter: d, height: h, tessellation: tess }, this.ctx.scene);
    m.material = this.ctx.mats.solid(hex, { emissive });
    m.position.set(...pos);
    m.parent = parent;
    this.ctx.onMesh(m, true);
    return m;
  }

  private node(name: string, parent: TransformNode = this.root): TransformNode {
    const n = new TransformNode(`${this.id}:${name}`, this.ctx.scene);
    n.parent = parent;
    return n;
  }

  /** Porta/portão: alinhado ao muro (vizinhos de parede em X → o painel atravessa X). */
  private spansX(obj: MapObject): boolean {
    const wall = (dx: number, dy: number) => getCell(this.ctx.map, { x: obj.pos.x + dx, y: obj.pos.y + dy, floor: obj.pos.floor })?.terrain === 'wall';
    if (wall(-1, 0) || wall(1, 0)) return true;
    if (wall(0, -1) || wall(0, 1)) return false;
    return true;
  }

  private build(obj: MapObject): void {
    const C = CELL_SIZE;
    switch (this.defId) {
      case 'door': {
        if (!this.spansX(obj)) this.root.rotation.y = Math.PI / 2;
        // Batente fixo + folha articulada na lateral esquerda.
        this.box('jamb-l', { w: 0.15, h: 2.8, d: 0.4 }, PALETTE.woodDark, [-C / 2 + 0.075, 1.4, 0]);
        this.box('jamb-r', { w: 0.15, h: 2.8, d: 0.4 }, PALETTE.woodDark, [C / 2 - 0.075, 1.4, 0]);
        this.box('lintel', { w: C, h: 0.2, d: 0.4 }, PALETTE.woodDark, [0, 2.9, 0]);
        const hinge = this.node('hinge');
        hinge.position.set(-C / 2 + 0.15, 0, 0);
        this.box('leaf', { w: C - 0.3, h: 2.6, d: 0.15 }, PALETTE.wood, [(C - 0.3) / 2, 1.3, 0], hinge);
        this.box('handle', { w: 0.12, h: 0.12, d: 0.3 }, PALETTE.gold, [C - 0.55, 1.2, 0], hinge);
        this.parts.hinge = hinge;
        break;
      }
      case 'gate': {
        if (!this.spansX(obj)) this.root.rotation.y = Math.PI / 2;
        this.box('post-l', { w: 0.25, h: 3, d: 0.5 }, PALETTE.metal, [-C / 2 + 0.125, 1.5, 0]);
        this.box('post-r', { w: 0.25, h: 3, d: 0.5 }, PALETTE.metal, [C / 2 - 0.125, 1.5, 0]);
        const grid = this.node('portcullis');
        for (let i = 0; i < 6; i++) this.cyl(`bar${i}`, 0.08, 2.7, PALETTE.metal, [-0.65 + i * 0.26, 1.35, 0], grid, 0, 8);
        this.box('cross1', { w: C - 0.5, h: 0.1, d: 0.1 }, PALETTE.metal, [0, 0.9, 0], grid);
        this.box('cross2', { w: C - 0.5, h: 0.1, d: 0.1 }, PALETTE.metal, [0, 2.0, 0], grid);
        this.parts.portcullis = grid;
        break;
      }
      case 'lever': {
        this.box('base', { w: 0.6, h: 0.25, d: 0.4 }, PALETTE.metal, [0, 0.125, 0]);
        const pivot = this.node('pivot');
        pivot.position.set(0, 0.25, 0);
        this.cyl('stick', 0.08, 0.9, PALETTE.woodDark, [0, 0.45, 0], pivot, 0, 8);
        const knob = MeshBuilder.CreateSphere(`${this.id}:knob`, { diameter: 0.2, segments: 8 }, this.ctx.scene);
        knob.material = this.ctx.mats.solid(PALETTE.leverKnob, { emissive: 0.2 });
        knob.position.set(0, 0.9, 0);
        knob.parent = pivot;
        this.ctx.onMesh(knob, true);
        this.parts.pivot = pivot;
        break;
      }
      case 'barrel': {
        this.cyl('body', 1.0, 1.2, PALETTE.barrel, [0, 0.6, 0]);
        this.cyl('band1', 1.04, 0.08, PALETTE.metal, [0, 0.25, 0]);
        this.cyl('band2', 1.04, 0.08, PALETTE.metal, [0, 0.95, 0]);
        break;
      }
      case 'crate': {
        this.box('body', { w: 1.4, h: 1.4, d: 1.4 }, PALETTE.crate, [0, 0.7, 0]);
        this.box('strap', { w: 1.44, h: 0.15, d: 1.44 }, PALETTE.woodDark, [0, 0.7, 0]);
        break;
      }
      case 'cistern': {
        this.cyl('basin', 1.8, 0.9, PALETTE.stone, [0, 0.45, 0], this.root, 0, 24);
        const water = MeshBuilder.CreateCylinder(`${this.id}:water`, { diameter: 1.55, height: 0.04, tessellation: 24 }, this.ctx.scene);
        water.material = this.ctx.mats.solid(PALETTE.water, { emissive: 0.25, specular: 0.6 });
        water.position.set(0, 0.91, 0);
        water.parent = this.root;
        this.ctx.onMesh(water, false);
        this.parts.water = water;
        break;
      }
      case 'chest': {
        this.box('body', { w: 1.2, h: 0.6, d: 0.8 }, PALETTE.woodDark, [0, 0.3, 0]);
        const lidPivot = this.node('lid');
        lidPivot.position.set(0, 0.6, -0.4);
        this.box('lid', { w: 1.22, h: 0.22, d: 0.82 }, PALETTE.wood, [0, 0.11, 0.41], lidPivot);
        this.box('lock', { w: 0.18, h: 0.2, d: 0.06 }, PALETTE.gold, [0, 0.05, 0.83], lidPivot, 0.2);
        this.parts.lid = lidPivot;
        break;
      }
      case 'focus_altar': {
        // Teste do pipeline GLB: placa de base (sem material no arquivo) em escala 0,5.
        const plate = this.node('plate');
        plate.scaling.setAll(0.5);
        this.ready = this.ctx.models.load(BASE_PLATE_URL).then((container) => {
          const inst = container.instantiateModelsToScene((n) => `${this.id}:${n}`, false, { doNotInstantiate: true });
          for (const r of inst.rootNodes) {
            r.parent = plate;
            for (const m of r.getChildMeshes(false)) {
              m.material = this.ctx.mats.solid(PALETTE.stone, { specular: 0.15 });
              this.ctx.onMesh(m, true);
            }
          }
        });
        this.cyl('column', 0.45, 0.9, PALETTE.stone, [0, 0.325 + 0.45, 0], this.root, 0, 12);
        const crystal = MeshBuilder.CreatePolyhedron(`${this.id}:crystal`, { type: 1, size: 0.25 }, this.ctx.scene);
        crystal.position.set(0, 1.55, 0);
        crystal.parent = this.root;
        this.ctx.onMesh(crystal, false);
        this.parts.crystal = crystal;
        break;
      }
      default: {
        // Objeto sem visual dedicado: cubo magenta para chamar atenção.
        this.box('unknown', { w: 1, h: 1, d: 1 }, '#ff00ff', [0, 0.5, 0]);
      }
    }
  }

  /** Reflete o estado atual (somente leitura do core). */
  update(obj: MapObject): void {
    this.place(obj);
    const key = `${obj.state}|${obj.burning}`;
    if (key === this.lastState) return;
    // Primeira sincronização: aplica direto; depois, portas/tampas/alavancas se movem.
    const animate = this.lastState !== null;
    this.lastState = key;
    const destroyed = obj.state === 'destroyed';
    switch (this.defId) {
      case 'door': {
        const hinge = this.parts.hinge as TransformNode;
        hinge.setEnabled(!destroyed);
        this.animateTo(hinge.rotation, 'y', obj.state === 'open' ? -Math.PI / 2 : 0, animate, 0.45);
        break;
      }
      case 'gate': {
        // Grade levadiça: aberta = recolhida para cima.
        this.animateTo((this.parts.portcullis as TransformNode).position, 'y', obj.state === 'open' ? 2.4 : 0, animate, 0.6);
        break;
      }
      case 'lever':
        this.animateTo((this.parts.pivot as TransformNode).rotation, 'z', obj.state === 'open' ? -0.6 : 0.6, animate, 0.3);
        break;
      case 'cistern':
        (this.parts.water as Mesh).setEnabled(obj.state !== 'used');
        break;
      case 'chest':
        this.animateTo((this.parts.lid as TransformNode).rotation, 'x', obj.state === 'used' ? -1.9 : 0, animate, 0.45);
        break;
      case 'focus_altar': {
        const used = obj.state === 'used';
        const crystal = this.parts.crystal as Mesh;
        crystal.material = this.ctx.mats.solid(used ? '#6a6475' : PALETTE.focus, { emissive: used ? 0 : 0.8 });
        break;
      }
      default:
        if (!destroyed) this.root.setEnabled(true);
    }
    if (destroyed) this.shatter(false);
    // Em combustão: tom alaranjado provisório (as partículas de fogo vêm depois).
    for (const m of this.root.getChildMeshes(false)) {
      if (m.metadata?.debris) continue;
      m.renderOverlay = obj.burning;
      m.overlayColor = BURNING_TINT;
      m.overlayAlpha = 0.45;
    }
  }

  /** Interpola uma propriedade numérica (porta, tampa, alavanca, grade). */
  private animateTo<T extends object>(target: T, prop: keyof T & string, value: number, animate: boolean, seconds: number): void {
    const rec = target as unknown as Record<string, number>;
    const from = rec[prop]!;
    if (!animate || Math.abs(from - value) < 1e-4) {
      rec[prop] = value;
      return;
    }
    void tween(this.ctx.scene, seconds, (t) => (rec[prop] = from + (value - from) * easeInOut(t)), { unpaced: true });
  }

  /**
   * Objeto destruído: o corpo some e ficam destroços simples (aduelas, aros, tábuas, lascas)
   * sobre uma mancha de fuligem. Com `animate`, os pedaços voam do centro e caem
   * (reprodução do OBJECT_DESTROYED); sem, aparecem já no lugar (sincronização).
   */
  shatter(animate: boolean): void {
    if (this.debris) return;
    if (!['barrel', 'crate', 'door'].includes(this.defId)) {
      this.root.setEnabled(false);
      return;
    }
    for (const child of this.root.getChildren()) (child as TransformNode).setEnabled(false);
    // Porta: o batente continua de pé.
    if (this.defId === 'door') for (const m of this.root.getChildren()) if (/jamb|lintel/.test(m.name)) (m as TransformNode).setEnabled(true);
    const debris = this.node('debris');
    this.debris = debris;
    const r = rand(hash(this.id));
    const pieces: Array<{ mesh: Mesh; end: Vector3; rot: Vector3 }> = [];
    const piece = (w: number, h: number, d: number, hex: string) => {
      const m = MeshBuilder.CreateBox(`${this.id}:debris${pieces.length}`, { width: w, height: h, depth: d }, this.ctx.scene);
      m.material = this.ctx.mats.solid(hex);
      m.parent = debris;
      m.metadata = { debris: true };
      this.ctx.onMesh(m, true);
      m.isPickable = false;
      const a = r() * Math.PI * 2;
      const dist = 0.25 + r() * 0.7;
      const end = new Vector3(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
      const rot = new Vector3(0, r() * Math.PI * 2, (r() - 0.5) * 0.25);
      pieces.push({ mesh: m, end, rot });
    };
    if (this.defId === 'barrel') {
      for (let i = 0; i < 7; i++) piece(0.22, 0.08, 0.7 + r() * 0.35, r() < 0.5 ? PALETTE.barrel : '#7a2a1c');
      for (let i = 0; i < 2; i++) piece(0.55, 0.05, 0.08, PALETTE.metal);
      piece(0.55, 0.06, 0.55, '#3a2a1c');
    } else if (this.defId === 'crate') {
      for (let i = 0; i < 6; i++) piece(0.3, 0.07, 0.9 + r() * 0.4, r() < 0.6 ? PALETTE.crate : PALETTE.woodDark);
      for (let i = 0; i < 3; i++) piece(0.18, 0.18, 0.18, PALETTE.crate);
    } else {
      for (let i = 0; i < 5; i++) piece(0.28, 0.08, 0.9 + r() * 0.8, r() < 0.6 ? PALETTE.wood : PALETTE.woodDark);
      piece(0.12, 0.12, 0.3, PALETTE.gold);
    }
    const scorch = MeshBuilder.CreateDisc(`${this.id}:scorch`, { radius: 0.95, tessellation: 20 }, this.ctx.scene);
    scorch.material = this.ctx.mats.solid('#1e1a16', { alpha: 0.6 });
    scorch.rotation.x = Math.PI / 2;
    scorch.position.y = 0.015;
    scorch.parent = debris;
    scorch.isPickable = false;
    scorch.metadata = { debris: true };
    for (const p of pieces) {
      p.mesh.position.copyFrom(p.end);
      p.mesh.rotation.copyFrom(p.rot);
    }
    if (!animate) return;
    // Voo: do centro (altura ~0,7 m) até o ponto final num arco, girando.
    const starts = pieces.map(() => new Vector3((r() - 0.5) * 0.3, 0.5 + r() * 0.5, (r() - 0.5) * 0.3));
    const lifts = pieces.map(() => 0.8 + r() * 1.4);
    const spins = pieces.map(() => new Vector3((r() - 0.5) * 12, (r() - 0.5) * 8, (r() - 0.5) * 12));
    void tween(this.ctx.scene, 0.7, (t) => {
      const e = easeOut(t);
      pieces.forEach((p, i) => {
        Vector3.LerpToRef(starts[i]!, p.end, e, p.mesh.position);
        p.mesh.position.y += Math.sin(Math.PI * t) * lifts[i]!;
        const k = 1 - t;
        p.mesh.rotation.set(p.rot.x + spins[i]!.x * k, p.rot.y + spins[i]!.y * k, p.rot.z + spins[i]!.z * k);
      });
      scorch.scaling.setAll(0.3 + 0.7 * e);
    }, { unpaced: true });
  }

  dispose(): void {
    this.root.dispose();
  }
}
