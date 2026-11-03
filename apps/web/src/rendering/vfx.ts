/**
 * Efeitos visuais de combate (etapa 4): cada evento aceito do core vira animação do
 * personagem + efeito — nada aqui decide resultado; só mostra o que o evento diz.
 *
 * - Geometria dos 22 GLBs do Blender (`assets/models/vfx/manifest.json`), com material sem
 *   luz na cor exata do manifesto (o PBR original somava luz + emissão × 1,6 e estourava
 *   para amarelo/branco).
 * - Partículas procedurais (`fx/particles.ts`, em pool) para rastros, faíscas, fumaça,
 *   cura, gelo e fogo.
 * - Efeitos persistentes sincronizados com o estado (`fx/stateFx.ts`): superfícies,
 *   barreira, enraizado, em chamas, lentidão, oculto, objetos em chamas.
 * - Animações falsas dos personagens (`unitAnimator.ts`), escolhidas pelo
 *   `presentation.animationId` da habilidade/arma/item.
 *
 * Ordem de uma ação (com `eventPlayback.ts`): animação do executor → projétil → selo do d20
 * → impacto/número → reações (explosão, superfícies). Ver `docs/vfx.md`.
 */
import { Color3, MeshBuilder, TransformNode, Vector3, type AbstractMesh, type Mesh, type Scene } from '@babylonjs/core';
import { catalog } from '@bardurinho/content';
import type { Coord, GameEvent, GameState } from '@bardurinho/domain';
import { bell, easeOut, tween, wait } from './anim.js';
import type { ArenaView } from './ArenaView.js';
import { FX_COLORS } from './fx/stateFx.js';
import { cellToWorld } from './grid.js';
import type { UnitAnimationId } from './unitAnimator.js';

/** Cores de reserva (iguais ao manifesto) caso o JSON não carregue. */
const FALLBACK_COLORS: Record<string, string> = {
  'projectile.fire': '#ff721c', 'projectile.frost': '#79eaff', 'projectile.arcane': '#b784ff', 'projectile.nature': '#9cfa65',
  'trail.arrow': '#ffe4a1', 'impact.physical': '#fff1b9', 'impact.wave': '#ffd295', 'charge.dust': '#c3a886',
  'barrier.arcane': '#b491ff', 'stealth.transition': '#8063be', 'surface.thorns': '#86bd41', 'status.roots': '#b6d75c',
  'heal.nature': '#91ffad', 'item.health': '#ff729a', 'item.focus': '#65bdff', 'item.oil': '#a58c54',
  'damage.physical': '#ff6653', 'damage.fire': '#ff901e', 'damage.cold': '#a3f5ff', 'damage.arcane': '#c38aff',
  'damage.nature': '#aeeb61', 'explosion.fire': '#ffac35',
};

const ITEM_EFFECTS: Record<string, { vfx: string; anim: UnitAnimationId }> = {
  'consumable.health_potion': { vfx: 'item.health', anim: 'cast_self' },
  'consumable.focus_potion': { vfx: 'item.focus', anim: 'cast_self' },
  'consumable.oil_flask': { vfx: 'item.oil', anim: 'shoot' },
};

/** Habilidades com alvo à distância sem projétil próprio no catálogo: semente da natureza. */
const CAST_PROJECTILE: Record<string, string> = { 'surface.thorns': 'projectile.nature', 'status.roots': 'projectile.nature' };

const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'arcane', 'nature'];

export interface ActionPresentation {
  vfxId?: string;
  animationId?: UnitAnimationId;
}

/** `presentation` (vfxId + animationId) da ação de um evento de uso. */
export function actionPresentation(event: GameEvent): ActionPresentation {
  const p = event.payload;
  if (event.type === 'ABILITY_USED') {
    const pr = catalog.abilities[String(p.abilityId)]?.presentation;
    return { vfxId: pr?.vfxId, animationId: pr?.animationId as UnitAnimationId | undefined };
  }
  if (event.type === 'ATTACK_PERFORMED') {
    const weapon = catalog.items[String(p.weaponId)];
    const pr = weapon?.kind === 'weapon' ? weapon.presentation : undefined;
    return { vfxId: pr?.vfxId, animationId: pr?.animationId as UnitAnimationId | undefined };
  }
  if (event.type === 'ITEM_USED') {
    const it = ITEM_EFFECTS[String(p.itemId)];
    return { vfxId: it?.vfx, animationId: it?.anim };
  }
  return {};
}

/** Compatibilidade: só o vfxId. */
export const actionVfx = (event: GameEvent): string | undefined => actionPresentation(event).vfxId;

const point = (c: Coord, lift = 0): Vector3 => {
  const p = cellToWorld(c);
  return new Vector3(p.x, p.y + lift, p.z);
};

/** Compatibilidade com o teste de assets: tween que resolve também no descarte da cena. */
export function animateVfx(scene: Scene, seconds: number, update: (t: number) => void): Promise<void> {
  return tween(scene, seconds, update, { unpaced: true });
}

export class CombatVfx {
  private warned = new Set<string>();
  private colors: Record<string, string> = { ...FALLBACK_COLORS };
  /** Pré-carregamento do manifesto e dos GLBs (evita travada no primeiro disparo). */
  readonly ready: Promise<void>;
  /** Tremor de câmera (ligado pela tela ao CameraController). */
  shake: ((amplitude: number, seconds: number) => void) | null = null;
  /** Explosão mais recente da reprodução atual (direção do recuo de quem foi atingido). */
  private lastBlast: { center: Vector3; via: string | null } | null = null;

  constructor(private readonly arena: ArenaView) {
    this.ready = this.preload();
  }

  private get scene(): Scene {
    return this.arena.scene;
  }

  private async preload(): Promise<void> {
    try {
      const res = await fetch('/models/vfx/manifest.json');
      if (res.ok) {
        const json = (await res.json()) as Record<string, { color?: string }>;
        for (const [id, v] of Object.entries(json)) if (v.color) this.colors[id] = v.color;
      }
    } catch {
      /* cores de reserva */
    }
    await Promise.all(
      Object.keys(this.colors).map((id) =>
        this.arena.models.load(`/models/vfx/${id}.glb`).then(
          () => undefined,
          (error: unknown) => this.warn(id, error),
        ),
      ),
    );
  }

  private warn(id: string, error: unknown): void {
    if (!this.warned.has(id)) console.warn(`VFX indisponível: ${id}`, error);
    this.warned.add(id);
  }

  color(id: string): Color3 {
    return Color3.FromHexString(this.colors[id] ?? '#ffffff');
  }

  /** Instancia um GLB de efeito com material sem luz na cor do manifesto. */
  private async spawn(id: string): Promise<{ root: TransformNode; meshes: AbstractMesh[]; dispose: () => void } | null> {
    const scene = this.scene;
    if (scene.isDisposed) return null;
    let container;
    try {
      container = await this.arena.models.load(`/models/vfx/${id}.glb`);
    } catch (error) {
      this.warn(id, error);
      return null;
    }
    if (scene.isDisposed) return null;
    const instance = container.instantiateModelsToScene((n) => `vfx:${n}`, false, { doNotInstantiate: true });
    const root = new TransformNode(`vfx:${id}`, scene);
    for (const node of instance.rootNodes) node.parent = root;
    const meshes = root.getChildMeshes();
    const mat = this.arena.mats.unlit(this.colors[id] ?? '#ffffff', { key: `vfx:${id}` });
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.material = mat;
    }
    return {
      root,
      meshes,
      dispose: () => {
        instance.dispose();
        root.dispose();
      },
    };
  }

  private ghostFactor(y: number): number {
    const floor = Math.max(0, Math.round((y - 0.8) / 4));
    return this.arena.floorView.isGhost(floor) ? 0.12 : 1;
  }

  /** Efeito pontual: cresce, gira um pouco e desaparece. */
  async burstGlb(id: string, at: Vector3, scale = 1, seconds = 0.5): Promise<void> {
    const fx = await this.spawn(id);
    if (!fx) return;
    fx.root.position.copyFrom(at);
    try {
      await tween(this.scene, seconds, (t) => {
        fx.root.rotation.y = t * 0.65;
        fx.root.scaling.setAll(scale * (0.35 + Math.sin((Math.min(1, t * 1.4) * Math.PI) / 2) * 0.85));
        const opacity = this.ghostFactor(at.y) * Math.min(1, (1 - t) * 3);
        for (const mesh of fx.meshes) mesh.visibility = opacity;
      });
    } finally {
      fx.dispose();
    }
  }

  /** Projétil de `from` até `to` (0,3–0,55 s conforme a distância), com halo e rastro. */
  async projectile(id: string, from: Vector3, to: Vector3): Promise<void> {
    const fx = await this.spawn(id);
    if (!fx) return;
    const color = this.color(id);
    const dist = Vector3.Distance(from, to);
    const seconds = Math.min(0.55, Math.max(0.3, dist / 18));
    const arc = id === 'item.oil' ? Math.min(2.5, 0.6 + dist * 0.18) : id === 'trail.arrow' ? Math.min(0.8, dist * 0.04) : 0;
    const halo = MeshBuilder.CreateSphere(`vfx:${id}:halo`, { diameter: id === 'trail.arrow' ? 0.3 : 0.7, segments: 8 }, this.scene);
    // Halo em mistura comum (aditivo estourava para branco sobre o piso claro).
    halo.material = this.arena.mats.unlit(this.colors[id] ?? '#ffffff', { alpha: 0.3 });
    halo.isPickable = false;
    halo.parent = fx.root;
    const trailAt = from.clone();
    const trail = this.arena.particles.loop('trail', trailAt, color, id === 'trail.arrow' ? 0.5 : 1);
    if (id === 'trail.arrow') trail.system.minSize = trail.system.maxSize = 0.12;
    const prev = from.clone();
    fx.root.position.copyFrom(from);
    fx.root.scaling.setAll(id === 'item.oil' ? 0.7 : id === 'trail.arrow' ? 1 : 1.25);
    try {
      await tween(this.scene, seconds, (t) => {
        prev.copyFrom(fx.root.position);
        Vector3.LerpToRef(from, to, t, fx.root.position);
        fx.root.position.y += bell(t) * arc;
        const v = fx.root.position.subtract(prev);
        if (v.lengthSquared() > 1e-6) {
          // Frente do GLB = +Z (como os personagens): guinada + arfagem pela velocidade.
          fx.root.rotation.y = Math.atan2(v.x, v.z);
          fx.root.rotation.x = -Math.atan2(v.y, Math.hypot(v.x, v.z));
        }
        if (id === 'item.oil') fx.root.rotation.z = t * 9;
        trailAt.copyFrom(fx.root.position);
        const g = this.ghostFactor(fx.root.position.y);
        for (const mesh of fx.meshes) mesh.visibility = g;
        halo.visibility = g * (0.85 + 0.15 * Math.sin(t * 30));
      });
    } finally {
      trail.stop();
      fx.dispose();
    }
  }

  /** Impacto de dano num ponto: GLB do tipo + faíscas na cor. */
  private impact(type: string, at: Vector3, big = false): Promise<void> {
    const id = `damage.${DAMAGE_TYPES.includes(type) ? type : 'physical'}`;
    this.arena.particles.burst('sparks', at, this.color(id), big ? 40 : 24, (ps) => {
      if (type === 'cold') ps.gravity.set(0, -3, 0);
    });
    return this.burstGlb(id, at, big ? 1.3 : 1, 0.45);
  }

  /** Grande explosão: clarão, bola de fogo, onda de choque sobre `cells`, faíscas, fumaça. */
  async explosion(center: Coord, cells: Coord[]): Promise<void> {
    const scene = this.scene;
    const c = point(center, 0.8);
    const ground = point(center, 0.06);
    this.shake?.(0.4, 0.45);
    const fireCol = this.color('explosion.fire');
    // Bola de fogo: núcleo claro + casca laranja, crescendo e sumindo rápido.
    const shell = MeshBuilder.CreateSphere('vfx:blast:shell', { diameter: 1, segments: 14 }, scene);
    shell.material = this.arena.mats.unlit('#ff6a14', { alpha: 0.85, key: 'vfx:blast:shell' });
    const core = MeshBuilder.CreateSphere('vfx:blast:core', { diameter: 1, segments: 12 }, scene);
    core.material = this.arena.mats.unlit('#ffd75a', { alpha: 0.95, key: 'vfx:blast:core' });
    for (const m of [shell, core]) {
      m.position.copyFrom(c);
      m.isPickable = false;
    }
    // Onda de choque: anel no chão até a borda da área.
    let radius = 1.5;
    for (const cell of cells) radius = Math.max(radius, Vector3.Distance(point(cell), point(center)) + 1);
    const ring = MeshBuilder.CreateTorus('vfx:blast:ring', { diameter: 2, thickness: 0.18, tessellation: 40 }, scene);
    ring.material = this.arena.mats.unlit('#ff9a2e', { alpha: 0.85, key: 'vfx:blast:ring' });
    ring.position.copyFrom(ground);
    ring.isPickable = false;
    // Células atingidas acendem e apagam.
    const flashes: Mesh[] = cells.map((cell, i) => {
      const q = MeshBuilder.CreateGround(`vfx:blast:cell${i}`, { width: 1.9, height: 1.9 }, scene);
      q.material = this.arena.mats.unlit('#ff6a10', { alpha: 0.45, key: 'vfx:blast:cell' });
      q.position.copyFrom(point(cell, 0.05));
      q.isPickable = false;
      q.alphaIndex = 60;
      return q;
    });
    this.arena.particles.burst('sparks', c, fireCol, 90, (ps) => {
      ps.minEmitPower = 5;
      ps.maxEmitPower = 11;
      ps.maxLifeTime = 0.9;
    });
    this.arena.particles.burst('smoke', c, new Color3(0.16, 0.14, 0.13), 26);
    const flash = this.burstGlb('explosion.fire', c, 2.8, 0.6);
    const anim = tween(scene, 0.7, (t) => {
      const e = easeOut(Math.min(1, t / 0.55));
      shell.scaling.setAll(0.5 + e * 3.6);
      core.scaling.setAll(0.4 + e * 2.4);
      shell.visibility = Math.max(0, 1 - t * 1.4);
      core.visibility = Math.max(0, 1 - t * 1.9);
      ring.scaling.set(0.3 + easeOut(t) * radius, 1, 0.3 + easeOut(t) * radius);
      ring.visibility = 1 - t;
      for (const q of flashes) q.visibility = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    }).then(() => {
      shell.dispose();
      core.dispose();
      ring.dispose();
      for (const q of flashes) q.dispose();
    });
    // A sequência segue com o clarão ainda no ar; fumaça e anel terminam sozinhos.
    await wait(scene, 0.45);
    void anim;
    void flash;
  }

  /** Cura / poções: partículas subindo + GLB + lampejo no personagem. */
  private async restore(unitId: string, id: string): Promise<void> {
    const view = this.arena.unitView(unitId);
    if (!view) return;
    const p = view.root.position;
    const color = this.color(id);
    this.arena.particles.burst('rise', p.add(new Vector3(0, 0.15, 0)), color, 36);
    view.flash(color, 0.5);
    await this.burstGlb(id, p.add(new Vector3(0, 0.9, 0)), 1.1, 0.6);
  }

  /** Ponto do mundo de uma entidade (personagem: peito; objeto: meio). */
  private entityPoint(id: string | null | undefined): Vector3 | null {
    if (!id) return null;
    const u = this.arena.unitView(id);
    if (u) return u.root.position.add(new Vector3(0, 1, 0));
    const o = this.arena.objectView(id);
    if (o) return o.root.position.add(new Vector3(0, 0.7, 0));
    return null;
  }

  /** Início de uma reprodução (zera o contexto entre comandos). */
  begin(): void {
    this.lastBlast = null;
  }

  async event(event: GameEvent, after?: GameState): Promise<void> {
    const p = event.payload;
    const fx = this.arena.stateFx;
    switch (event.type) {
      case 'ATTACK_PERFORMED':
      case 'ABILITY_USED':
      case 'ITEM_USED':
        return this.action(event);
      case 'DAMAGE_APPLIED': {
        const id = String(p.targetId);
        const view = this.arena.unitView(id);
        if (!view) return;
        const at = view.root.position.add(new Vector3(0, 1, 0));
        const effects: Promise<void>[] = [];
        if (Number(p.shieldAbsorbed) > 0) {
          fx.pulseShield(id);
          effects.push(this.burstGlb('barrier.arcane', at, 1.2, 0.45));
          if (Number(p.shieldAfter) <= 0) fx.setShield(id, false);
        }
        if (Number(p.hpDamage) > 0) {
          effects.push(this.impact(String(p.damageType), at));
          // Recuo para longe da origem (explosão, atacante ou objeto).
          const via = p.via == null ? null : String(p.via);
          const from = this.lastBlast && via === this.lastBlast.via ? this.lastBlast.center : this.entityPoint(event.cause.sourceId);
          if (!p.defeated) effects.push(this.arena.animator.play(view, 'hit', { toward: from && from.subtract(at).lengthSquared() > 0.01 ? from : undefined }).done);
          else view.flash(new Color3(1, 0.12, 0.08), 0.8);
        }
        // Não espera o impacto inteiro: o número já está na tela.
        await Promise.race([Promise.all(effects), wait(this.scene, 0.22)]);
        return;
      }
      case 'OBJECT_DAMAGED': {
        const at = this.entityPoint(String(p.objectId));
        if (at) await Promise.race([this.impact(String(p.damageType), at), wait(this.scene, 0.15)]);
        return;
      }
      case 'OBJECT_DESTROYED': {
        const view = this.arena.objectView(String(p.objectId));
        if (!view) return;
        view.shatter(true);
        this.arena.particles.burst('dust', view.root.position.add(new Vector3(0, 0.3, 0)), new Color3(0.42, 0.36, 0.3), 18);
        fx.setObjectBurning(view.id, false);
        return;
      }
      case 'EXPLOSION': {
        const objectId = p.objectId ? String(p.objectId) : null;
        this.lastBlast = { center: point(p.center as Coord, 1), via: objectId ? (this.arena.objectView(objectId)?.defId ?? null) : null };
        await this.explosion(p.center as Coord, (p.cells as Coord[]) ?? []);
        return;
      }
      case 'HEALED':
        if (Number(p.effective ?? 1) <= 0) return;
        await this.restore(String(p.unitId), event.cause.definitionId === 'consumable.health_potion' ? 'item.health' : 'heal.nature');
        return;
      case 'RESOURCE_RESTORED':
        if (event.cause.definitionId === 'consumable.focus_potion' && Number(p.after) > Number(p.before)) await this.restore(String(p.unitId), 'item.focus');
        return;
      case 'SHIELD_GRANTED': {
        if (!p.applied) return;
        const id = String(p.unitId);
        const view = this.arena.unitView(id);
        if (!view) return;
        fx.setShield(id, true);
        this.arena.particles.burst('rise', view.root.position.add(new Vector3(0, 0.2, 0)), FX_COLORS.arcane, 24);
        await this.burstGlb('barrier.arcane', view.root.position.add(new Vector3(0, 1, 0)), 1.25, 0.55);
        return;
      }
      case 'SHIELD_EXPIRED':
        fx.setShield(String(p.unitId), false);
        return;
      case 'STATUS_APPLIED':
      case 'STATUS_REFRESHED': {
        const id = String(p.unitId);
        const status = String(p.statusId);
        const view = this.arena.unitView(id);
        if (!view) return;
        fx.setStatus(id, status, true);
        const at = view.root.position.add(new Vector3(0, 1, 0));
        if (status === 'hidden') await this.burstGlb('stealth.transition', at, 1.2, 0.5);
        else if (status === 'slowed') this.arena.particles.burst('sparks', at, FX_COLORS.frost, 20, (ps) => ps.gravity.set(0, -2, 0));
        else if (status === 'rooted') this.arena.particles.burst('dust', view.root.position, new Color3(0.4, 0.33, 0.2), 14);
        else if (status === 'burning') this.arena.particles.burst('sparks', at, FX_COLORS.fire, 16);
        return;
      }
      case 'STATUS_REMOVED':
      case 'STATUS_EXPIRED': {
        const id = String(p.unitId);
        const status = String(p.statusId);
        const view = this.arena.unitView(id);
        fx.setStatus(id, status, false);
        if (view && status === 'hidden') await this.burstGlb('stealth.transition', view.root.position.add(new Vector3(0, 1, 0)), 1.1, 0.4);
        if (view && status === 'burning') this.arena.particles.burst('smoke', view.root.position.add(new Vector3(0, 1.2, 0)), new Color3(0.3, 0.3, 0.3), 6);
        return;
      }
      case 'SURFACE_CREATED': {
        const cell = p.cell as Coord;
        const kind = p.surface as 'oil' | 'fire' | 'thorns';
        fx.setSurface(cell, kind, true);
        const at = point(cell, 0.2);
        if (kind === 'fire') this.arena.particles.burst('sparks', at, FX_COLORS.fire, 14);
        else if (kind === 'oil') this.arena.particles.burst('dust', at, new Color3(0.2, 0.16, 0.08), 8);
        else this.arena.particles.burst('dust', at, new Color3(0.3, 0.42, 0.16), 8);
        // Pequeno escalonamento: as células aparecem em sequência.
        await wait(this.scene, 0.05);
        return;
      }
      case 'SURFACE_REMOVED':
      case 'SURFACE_EXPIRED': {
        const cell = p.cell as Coord;
        fx.setSurface(cell, null, true);
        if (p.surface === 'fire') this.arena.particles.burst('smoke', point(cell, 0.4), new Color3(0.32, 0.3, 0.28), 5);
        return;
      }
      case 'OBJECT_IGNITED': {
        const id = String(p.objectId);
        fx.setObjectBurning(id, true, this.arena.objectView(id) ? Math.round(this.arena.objectView(id)!.root.position.y / 4) : 0);
        return;
      }
      case 'OBJECT_EXTINGUISHED': {
        const id = String(p.objectId);
        fx.setObjectBurning(id, false);
        const at = this.entityPoint(id);
        if (at) this.arena.particles.burst('smoke', at, new Color3(0.35, 0.35, 0.35), 6);
        return;
      }
      case 'OBJECT_STATE_CHANGED': {
        // Interação: o personagem se inclina para o objeto e o objeto já se move.
        const objectId = String(p.objectId);
        const obj = this.arena.objectView(objectId);
        const actor = this.arena.unitView(String(event.cause.sourceId ?? ''));
        const state = after?.objects[objectId];
        if (actor && obj && Vector3.Distance(actor.root.position, obj.root.position) < 3.2) {
          await this.arena.animator.play(actor, 'interact', { toward: obj.root.position }).release;
        }
        if (obj && state && state.state !== 'destroyed') obj.update({ ...state, state: p.to as typeof state.state });
        return;
      }
      case 'UNIT_DEFEATED': {
        const id = String(p.unitId);
        const view = this.arena.unitView(id);
        fx.clearUnit(id);
        if (!view) return;
        this.arena.particles.burst('dust', view.root.position.add(new Vector3(0, 0.2, 0)), new Color3(0.4, 0.37, 0.33), 16);
        await this.arena.animator.play(view, 'death').done;
        return;
      }
    }
  }

  /** Uso de arma/habilidade/item: animação do executor, projétil e efeito no alvo. */
  private async action(event: GameEvent): Promise<void> {
    const p = event.payload;
    const { vfxId, animationId } = actionPresentation(event);
    const actor = this.arena.unitView(String(p.actorId));
    const target = p.target as Coord | undefined;
    if (!actor) return;
    const origin = actor.root.position.add(new Vector3(0, 1.15, 0));
    const at = target ? point(target, 1) : origin.clone();
    const self = !target || Vector3.Distance(new Vector3(at.x, 0, at.z), new Vector3(origin.x, 0, origin.z)) < 0.2;
    const color = vfxId ? this.color(vfxId) : undefined;
    const anim = this.arena.animator.play(actor, animationId ?? (self ? 'cast_self' : 'melee'), { toward: self ? undefined : at, color });
    await anim.release;
    if (!vfxId) return void (await anim.done);

    const projectileId = vfxId.startsWith('projectile.') || vfxId === 'trail.arrow' || vfxId === 'item.oil' ? vfxId : CAST_PROJECTILE[vfxId];
    if (projectileId && !self) {
      // Sai das mãos (frente do personagem), chega no peito do alvo / no chão da célula.
      const f = actor.facing();
      const from = origin.add(new Vector3(f.x * 0.55, 0, f.z * 0.55));
      const to = vfxId === 'item.oil' || vfxId === 'surface.thorns' ? point(target!, 0.25) : at;
      await this.projectile(projectileId, from, to);
      if (vfxId === 'surface.thorns' || vfxId === 'status.roots') this.arena.particles.burst('sparks', to, this.color('projectile.nature'), 16);
      await anim.done;
      return;
    }
    switch (vfxId) {
      case 'impact.physical':
        // Corte no alvo no pico da investida.
        void this.burstGlb('impact.physical', at, 1.1, 0.35);
        break;
      case 'impact.wave':
        void this.burstGlb('impact.wave', at, 1.2, 0.45);
        this.arena.particles.burst('dust', point(target!, 0.1), this.color('impact.wave'), 12);
        break;
      case 'charge.dust':
        this.arena.particles.burst('dust', actor.root.position.add(new Vector3(0, 0.1, 0)), this.color('charge.dust'), 20);
        void this.burstGlb('charge.dust', actor.root.position.add(new Vector3(0, 0.3, 0)), 1.2, 0.5);
        break;
      case 'stealth.transition':
      case 'barrier.arcane':
      case 'heal.nature':
      case 'item.health':
      case 'item.focus':
        // Resultados (barreira, cura, ocultação) vêm dos eventos seguintes.
        break;
      default:
        if (!self) void this.burstGlb(vfxId, at, 1, 0.45);
    }
    await anim.done;
  }
}
