/**
 * Efeitos persistentes que espelham o estado (só leitura): superfícies (óleo, fogo,
 * espinhos), estados dos personagens (barreira, enraizado, em chamas, lentidão, oculto) e
 * objetos em chamas.
 *
 * Durante a reprodução, os eventos ligam/desligam cada efeito na hora certa
 * (`setSurface`, `setStatus`, `setShield`, …); `sync(state)` reconcilia tudo com o estado
 * oficial ao fim de cada comando (e cobre estados iniciais, como o óleo do mapa).
 *
 * Custos: uma malha de decalque por célula com superfície; fogo = 1 sistema de partículas
 * (≤ 42) por célula; personagem em chamas ≤ 22; lentidão ≤ 18; oculto ≤ 16. Materiais e
 * texturas são compartilhados; sistemas de partículas voltam ao pool (`ParticleFx`).
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  FresnelParameters,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,

  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { allCoords, getCell, type Coord, type GameState, type SurfaceKind } from '@bardurinho/domain';
import { easeOut, hash, rand, tween } from '../anim.js';
import type { FloorView } from '../floorView.js';
import { CELL_SIZE, cellToWorld } from '../grid.js';
import type { ModelLibrary } from '../loaders.js';
import type { Materials } from '../materials.js';
import type { ObjectView } from '../objects.js';
import type { UnitView } from '../units.js';
import type { ParticleFx, ParticleHandle } from './particles.js';

export const FX_COLORS = {
  fire: Color3.FromHexString('#ff721c'),
  frost: Color3.FromHexString('#79eaff'),
  arcane: Color3.FromHexString('#b491ff'),
  nature: Color3.FromHexString('#9cfa65'),
  roots: Color3.FromHexString('#b6d75c'),
  stealth: Color3.FromHexString('#8063be'),
};

export interface StateFxDeps {
  scene: Scene;
  mats: Materials;
  models: ModelLibrary;
  floorView: FloorView;
  particles: ParticleFx;
  unitView(id: string): UnitView | undefined;
  objectView(id: string): ObjectView | undefined;
}

interface SurfaceVisual {
  kind: SurfaceKind;
  floor: number;
  root: TransformNode;
  decal: Mesh;
  flames?: ParticleHandle;
  phase: number;
}

interface UnitVisual {
  shield?: { mesh: Mesh; pulse: number; leaving: boolean };
  roots?: TransformNode;
  burning?: ParticleHandle;
  burnAt?: Vector3;
  slowed?: ParticleHandle;
  slowAt?: Vector3;
  hidden?: ParticleHandle;
  hideAt?: Vector3;
}

const key = (c: Coord) => `${c.x},${c.y},${c.floor}`;
const THORNS_URL = '/models/vfx/surface.thorns.glb';
const ROOTS_URL = '/models/vfx/status.roots.glb';

export class StateFx {
  private readonly surfaces = new Map<string, SurfaceVisual>();
  private readonly units = new Map<string, UnitVisual>();
  private readonly objectFlames = new Map<string, { handle: ParticleHandle; floor: number }>();
  private readonly decalMats = new Map<SurfaceKind, StandardMaterial>();
  private shieldMat: StandardMaterial | null = null;
  private time = 0;

  constructor(private readonly d: StateFxDeps) {
    d.scene.onBeforeRenderObservable.add(() => this.frame());
  }

  // --- Reconciliação -------------------------------------------------------------------

  sync(state: GameState): void {
    const seen = new Set<string>();
    for (const c of allCoords(state.map)) {
      const s = getCell(state.map, c)?.surface;
      if (!s) continue;
      seen.add(key(c));
      this.setSurface(c, s.kind, false);
    }
    for (const [k, v] of this.surfaces) if (!seen.has(k)) this.removeSurface(k, v, false);

    for (const u of Object.values(state.units)) {
      if (!u.alive) {
        this.clearUnit(u.id);
        continue;
      }
      const has = new Set(u.statuses.map((s) => s.statusId));
      for (const id of ['burning', 'slowed', 'rooted', 'hidden']) this.setStatus(u.id, id, has.has(id), false);
      this.setShield(u.id, !!u.shield && u.shield.amount > 0, false);
    }
    for (const id of this.units.keys()) if (!state.units[id]) this.clearUnit(id);

    for (const o of Object.values(state.objects)) this.setObjectBurning(o.id, o.burning && o.state !== 'destroyed', o.pos.floor);
    for (const id of this.objectFlames.keys()) if (!state.objects[id]) this.setObjectBurning(id, false, 0);
  }

  // --- Superfícies ---------------------------------------------------------------------

  setSurface(c: Coord, kind: SurfaceKind | null, animate = true): void {
    const k = key(c);
    const existing = this.surfaces.get(k);
    if (existing && existing.kind === kind) return;
    if (existing) this.removeSurface(k, existing, animate);
    if (!kind) return;
    const { scene } = this.d;
    const w = cellToWorld(c);
    const r = rand(hash(`${k}:${kind}`));
    const root = new TransformNode(`surface:${k}`, scene);
    root.position.set(w.x, w.y, w.z);
    const size = kind === 'oil' ? CELL_SIZE * 1.12 : CELL_SIZE * 1.02;
    const decal = MeshBuilder.CreateGround(`surface:${k}:decal`, { width: size, height: size }, scene);
    decal.material = this.decalMaterial(kind);
    decal.parent = root;
    decal.position.y = kind === 'oil' ? 0.02 : 0.025;
    decal.rotation.y = r() * Math.PI * 2;
    decal.isPickable = false;
    decal.receiveShadows = kind !== 'fire';
    // Antes dos destaques de células (alphaIndex 100+), para o alcance aparecer por cima.
    decal.alphaIndex = 50;
    const v: SurfaceVisual = { kind, floor: c.floor, root, decal, phase: r() * 10 };
    if (kind === 'fire') {
      v.flames = this.d.particles.loop('flame', new Vector3(w.x, w.y + 0.05, w.z), FX_COLORS.fire);
    } else if (kind === 'thorns') {
      void this.d.models.load(THORNS_URL).then((container) => {
        if (this.surfaces.get(k) !== v) return;
        for (let i = 0; i < 2; i++) {
          const inst = container.instantiateModelsToScene((n) => `surface:${k}:thorns${i}:${n}`, false, { doNotInstantiate: true });
          const holder = new TransformNode(`surface:${k}:thorns${i}`, scene);
          holder.parent = root;
          holder.rotation.y = r() * Math.PI * 2 + i * 2.1;
          holder.position.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
          const s = 0.75 + r() * 0.25;
          holder.scaling.setAll(s);
          for (const n of inst.rootNodes) {
            n.parent = holder;
            for (const m of n.getChildMeshes(false)) {
              m.material = this.d.mats.solid('#5f8f2c', { emissive: 0.35, specular: 0.15, key: 'fx:thorns' });
              m.isPickable = false;
              m.receiveShadows = true;
            }
          }
          if (animate) void tween(scene, 0.35, (t) => holder.scaling.set(s, s * easeOut(t), s), { unpaced: false });
        }
        this.d.floorView.register(root, c.floor);
      });
    }
    this.d.floorView.register(root, c.floor);
    if (animate) {
      decal.scaling.setAll(0.2);
      void tween(scene, kind === 'oil' ? 0.3 : 0.22, (t) => decal.scaling.setAll(0.2 + 0.8 * easeOut(t)));
    }
    this.surfaces.set(k, v);
  }

  private removeSurface(k: string, v: SurfaceVisual, animate: boolean): void {
    this.surfaces.delete(k);
    v.flames?.stop();
    const done = () => {
      this.d.floorView.unregister(v.root);
      v.root.dispose();
    };
    if (!animate) return done();
    void tween(this.d.scene, 0.3, (t) => v.root.scaling.set(1, 1 - t, 1)).then(done);
  }

  private decalMaterial(kind: SurfaceKind): StandardMaterial {
    let m = this.decalMats.get(kind);
    if (m) return m;
    const { scene } = this.d;
    m = new StandardMaterial(`mat:surface:${kind}`, scene);
    const tex = blobTexture(scene, kind);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.backFaceCulling = true;
    if (kind === 'oil') {
      // Poça escura e brilhante (reflexo especular forte).
      m.diffuseColor = new Color3(1, 1, 1);
      m.specularColor = new Color3(0.9, 0.85, 0.7);
      m.specularPower = 90;
    } else if (kind === 'fire') {
      // Brasa no chão: sem luz, somada ao piso; a cintilação vem da visibilidade.
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.alphaMode = Constants.ALPHA_ADD;
    } else {
      m.specularColor = new Color3(0.05, 0.05, 0.05);
    }
    this.decalMats.set(kind, m);
    return m;
  }

  // --- Estados dos personagens ---------------------------------------------------------

  private unit(id: string): UnitVisual {
    let v = this.units.get(id);
    if (!v) {
      v = {};
      this.units.set(id, v);
    }
    return v;
  }

  setStatus(unitId: string, statusId: string, on: boolean, animate = true): void {
    const view = this.d.unitView(unitId);
    if (!view) return;
    const v = this.unit(unitId);
    const p = view.root.position;
    switch (statusId) {
      case 'burning':
        if (on && !v.burning) {
          v.burnAt = p.add(new Vector3(0, 0.15, 0));
          v.burning = this.d.particles.loop('flameSmall', v.burnAt, FX_COLORS.fire);
        } else if (!on && v.burning) {
          v.burning.stop();
          v.burning = undefined;
        }
        break;
      case 'slowed':
        if (on && !v.slowed) {
          v.slowAt = p.add(new Vector3(0, 2.1, 0));
          v.slowed = this.d.particles.loop('frost', v.slowAt, FX_COLORS.frost);
        } else if (!on && v.slowed) {
          v.slowed.stop();
          v.slowed = undefined;
        }
        break;
      case 'rooted':
        if (on && !v.roots) this.addRoots(unitId, view, v, animate);
        else if (!on && v.roots) {
          const roots = v.roots;
          v.roots = undefined;
          if (animate) void tween(this.d.scene, 0.3, (t) => roots.scaling.set(1.15, 1.15 * (1 - t), 1.15)).then(() => roots.dispose());
          else roots.dispose();
        }
        break;
      case 'hidden':
        if (on && !v.hidden) {
          v.hideAt = p.add(new Vector3(0, 1, 0));
          v.hidden = this.d.particles.loop('shimmer', v.hideAt, FX_COLORS.stealth);
        } else if (!on && v.hidden) {
          v.hidden.stop();
          v.hidden = undefined;
          view.setOpacity(1);
        }
        break;
    }
    // Tinta: lentidão (azul gelo) tem prioridade sobre ocultação (lilás).
    view.setTint(v.slowed ? FX_COLORS.frost : v.hidden ? FX_COLORS.stealth : null, v.slowed ? 0.32 : 0.28);
  }

  private addRoots(unitId: string, view: UnitView, v: UnitVisual, animate: boolean): void {
    const holder = new TransformNode(`fx:roots:${unitId}`, this.d.scene);
    holder.parent = view.root;
    holder.position.y = 0.02;
    holder.scaling.setAll(1.15);
    v.roots = holder;
    void this.d.models.load(ROOTS_URL).then((container) => {
      if (v.roots !== holder || holder.isDisposed()) return;
      const inst = container.instantiateModelsToScene((n) => `fx:roots:${unitId}:${n}`, false, { doNotInstantiate: true });
      for (const n of inst.rootNodes) {
        n.parent = holder;
        for (const m of n.getChildMeshes(false)) {
          m.material = this.d.mats.solid('#7da53a', { emissive: 0.45, specular: 0.1, key: 'fx:roots' });
          m.isPickable = false;
        }
      }
      if (animate) void tween(this.d.scene, 0.4, (t) => holder.scaling.set(1.15, 1.15 * easeOut(t), 1.15));
    });
  }

  setShield(unitId: string, on: boolean, animate = true): void {
    const view = this.d.unitView(unitId);
    if (!view) return;
    const v = this.unit(unitId);
    if (on && (!v.shield || v.shield.leaving)) {
      v.shield?.mesh.dispose();
      const mesh = MeshBuilder.CreateSphere(`fx:shield:${unitId}`, { diameter: 2.3, segments: 20 }, this.d.scene);
      mesh.material = this.shieldMaterial();
      mesh.parent = view.root;
      mesh.position.y = 1.0;
      mesh.scaling.set(1, 1.08, 1);
      mesh.isPickable = false;
      mesh.alphaIndex = 200;
      const sh = { mesh, pulse: 0, leaving: false };
      v.shield = sh;
      if (animate) void tween(this.d.scene, 0.35, (t) => mesh.scaling.set(easeOut(t), 1.08 * easeOut(t), easeOut(t))).then(() => (sh.pulse = 1));
    } else if (!on && v.shield && !v.shield.leaving) {
      const sh = v.shield;
      sh.leaving = true;
      const done = () => {
        sh.mesh.dispose();
        if (v.shield === sh) v.shield = undefined;
      };
      if (!animate) return done();
      void tween(this.d.scene, 0.4, (t) => {
        sh.mesh.scaling.setAll(1 + t * 0.35);
        sh.mesh.visibility = 1 - t;
      }).then(done);
    }
  }

  /** Barreira absorveu dano: pulso de brilho. */
  pulseShield(unitId: string): void {
    const sh = this.units.get(unitId)?.shield;
    if (sh && !sh.leaving) sh.pulse = 1;
  }

  private shieldMaterial(): StandardMaterial {
    if (this.shieldMat) return this.shieldMat;
    const m = new StandardMaterial('mat:fx:shield', this.d.scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = FX_COLORS.arcane;
    m.alpha = 0.5;
    // Borda opaca e centro quase transparente (bolha).
    m.opacityFresnelParameters = new FresnelParameters({ bias: 0.0, power: 3.2, leftColor: Color3.White(), rightColor: Color3.Black() });
    m.emissiveFresnelParameters = new FresnelParameters({ bias: 0.3, power: 1.5, leftColor: new Color3(0.95, 0.85, 1), rightColor: FX_COLORS.arcane.scale(0.6) });
    m.backFaceCulling = true;
    this.shieldMat = m;
    return m;
  }

  clearUnit(unitId: string): void {
    const v = this.units.get(unitId);
    if (!v) return;
    for (const s of ['burning', 'slowed', 'rooted', 'hidden']) this.setStatus(unitId, s, false, false);
    this.setShield(unitId, false, false);
    this.units.delete(unitId);
  }

  // --- Objetos -------------------------------------------------------------------------

  setObjectBurning(objectId: string, on: boolean, floor = 0): void {
    const cur = this.objectFlames.get(objectId);
    if (on && !cur) {
      const view = this.d.objectView(objectId);
      if (!view) return;
      const p = view.root.position;
      const handle = this.d.particles.loop('flame', new Vector3(p.x, p.y + 0.9, p.z), FX_COLORS.fire, 0.8);
      handle.system.minEmitBox = new Vector3(-0.35, 0, -0.35);
      handle.system.maxEmitBox = new Vector3(0.35, 0.3, 0.35);
      this.objectFlames.set(objectId, { handle, floor });
    } else if (!on && cur) {
      cur.handle.stop();
      this.objectFlames.delete(objectId);
    }
  }

  // --- Quadro --------------------------------------------------------------------------

  private frame(): void {
    const dt = Math.min(0.1, this.d.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    const fv = this.d.floorView;
    for (const s of this.surfaces.values()) {
      const ghost = fv.isGhost(s.floor);
      if (s.kind === 'fire') {
        // Cintilação da brasa (barata: só a visibilidade da malha).
        const f = 0.75 + 0.18 * Math.sin(this.time * 9 + s.phase) + 0.07 * Math.sin(this.time * 23 + s.phase * 3);
        s.decal.visibility = (ghost ? 0.12 : 1) * f;
        if (s.flames) s.flames.system.emitRate = ghost ? 0 : 24;
      }
    }
    for (const [id, v] of this.units) {
      const view = this.d.unitView(id);
      if (!view) continue;
      const p = view.root.position;
      const ghost = fv.isGhost(view.floor);
      v.burnAt?.set(p.x, p.y + 0.15, p.z);
      v.slowAt?.set(p.x, p.y + 2.1, p.z);
      v.hideAt?.set(p.x, p.y + 1, p.z);
      if (v.burning) v.burning.system.emitRate = ghost ? 0 : 16;
      if (v.hidden) view.setOpacity(0.3 + 0.08 * Math.sin(this.time * 5.5));
      if (v.shield && !v.shield.leaving) {
        const sh = v.shield;
        sh.pulse = Math.max(0, sh.pulse - dt * 2.5);
        const breathe = 1 + 0.025 * Math.sin(this.time * 3);
        const pop = 1 + sh.pulse * 0.18;
        if (sh.mesh.scaling.x >= 0.99 || sh.pulse > 0) sh.mesh.scaling.set(breathe * pop, 1.08 * breathe * pop, breathe * pop);
        sh.mesh.visibility = (ghost ? 0.12 : 1) * Math.min(1, 0.75 + sh.pulse * 0.6);
        sh.mesh.rotation.y += dt * 0.4;
      }
    }
    for (const f of this.objectFlames.values()) f.handle.system.emitRate = fv.isGhost(f.floor) ? 0 : 19;
  }
}

/** Mancha irregular (óleo, brasa, espinhos) desenhada em canvas, com borda suave. */
function blobTexture(scene: Scene, kind: SurfaceKind): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(`fx:blob:${kind}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const r = rand(hash(kind));
  const blobs = kind === 'fire' ? 4 : 7;
  for (let i = 0; i < blobs; i++) {
    const cx = size / 2 + (r() - 0.5) * size * (kind === 'fire' ? 0.2 : 0.38);
    const cy = size / 2 + (r() - 0.5) * size * (kind === 'fire' ? 0.2 : 0.38);
    const rad = size * (kind === 'fire' ? 0.42 : 0.2 + r() * 0.14);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    if (kind === 'oil') {
      g.addColorStop(0, 'rgba(24,19,10,0.95)');
      g.addColorStop(0.75, 'rgba(34,27,14,0.9)');
      g.addColorStop(1, 'rgba(40,32,16,0)');
    } else if (kind === 'fire') {
      g.addColorStop(0, 'rgba(255,170,60,0.75)');
      g.addColorStop(0.45, 'rgba(255,100,20,0.5)');
      g.addColorStop(1, 'rgba(120,20,0,0)');
    } else {
      g.addColorStop(0, 'rgba(48,66,24,0.85)');
      g.addColorStop(0.7, 'rgba(58,78,30,0.6)');
      g.addColorStop(1, 'rgba(60,80,30,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.hasAlpha = true;
  tex.update();
  return tex;
}


