/**
 * Rótulos HTML presos a pontos do mundo 3D: custo do caminho (PM), chance de acerto, barras
 * de PV sobre os personagens, números flutuantes de dano/cura e o resultado dos dados. A
 * posição é reprojetada a cada quadro (ou segue um nó, `follow`); nada aqui lê regras.
 *
 * Andar fantasma (seção 14.6): `ghostAt(ponto)` (ligado pela tela) diz se o ponto pertence
 * a algo num andar acima do visualizado; o rótulo ganha a classe `ghost` (mesma opacidade
 * dos personagens fantasmas), como o modelo, a barra e os efeitos do personagem.
 */
import { Matrix, Vector3, type Engine, type Scene } from '@babylonjs/core';

interface Label {
  el: HTMLDivElement;
  world: Vector3;
  /** Posição dinâmica (ex.: acima da cabeça de um personagem em movimento). */
  follow?: () => Vector3 | null;
  html?: string;
  /** Rótulos flutuantes: instante de criação e duração (ms). */
  born?: number;
  life?: number;
}

export class WorldLabels {
  readonly root: HTMLDivElement;
  private readonly pinned = new Map<string, Label>();
  private floating: Label[] = [];
  /** O ponto está num andar fantasma? (padrão: nunca). */
  ghostAt: (world: Vector3) => boolean = () => false;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'world-labels';
    parent.append(this.root);
    scene.onAfterRenderObservable.add(() => this.update());
  }

  /** Rótulo fixo identificado por `key` (cria ou atualiza). */
  pin(key: string, text: string, world: Vector3, className: string): void {
    let l = this.pinned.get(key);
    if (!l) {
      l = { el: document.createElement('div'), world: world.clone() };
      this.root.append(l.el);
      this.pinned.set(key, l);
    }
    l.world.copyFrom(world);
    l.el.className = `world-label ${className}`;
    if (l.el.textContent !== text) l.el.textContent = text;
  }

  /** Rótulo fixo com HTML, opcionalmente seguindo uma posição dinâmica. */
  pinHtml(key: string, html: string, world: Vector3 | (() => Vector3 | null), className: string): HTMLDivElement {
    let l = this.pinned.get(key);
    if (!l) {
      l = { el: document.createElement('div'), world: new Vector3() };
      this.root.append(l.el);
      this.pinned.set(key, l);
    }
    if (typeof world === 'function') l.follow = world;
    else {
      l.follow = undefined;
      l.world.copyFrom(world);
    }
    const cls = `world-label ${className}`;
    if (l.el.className !== cls) l.el.className = cls;
    if (l.html !== html) {
      l.html = html;
      l.el.innerHTML = html;
    }
    return l.el;
  }

  unpin(key: string): void {
    const l = this.pinned.get(key);
    if (!l) return;
    l.el.remove();
    this.pinned.delete(key);
  }

  /** Número/texto que sobe e some (ex.: dano). */
  float(text: string, world: Vector3, className: string, lifeMs = 1700, html = false): void {
    const el = document.createElement('div');
    el.className = `world-label floating ${className}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
    el.style.animationDuration = `${lifeMs}ms`;
    this.root.append(el);
    this.floating.push({ el, world: world.clone(), born: performance.now(), life: lifeMs });
  }

  private project(l: Label, transform: Matrix, vw: number, vh: number, scaleX: number, scaleY: number): void {
    if (l.follow) {
      const p = l.follow();
      if (!p) {
        l.el.style.display = 'none';
        return;
      }
      l.world.copyFrom(p);
    }
    const camera = this.scene.activeCamera!;
    const viewport = camera.viewport.toGlobal(vw, vh);
    const p = Vector3.Project(l.world, Matrix.IdentityReadOnly, transform, viewport);
    const behind = p.z < 0 || p.z > 1;
    l.el.style.display = behind ? 'none' : '';
    l.el.classList.toggle('ghost', !behind && this.ghostAt(l.world));
    l.el.style.transform = `translate(${(p.x * scaleX).toFixed(1)}px, ${(p.y * scaleY).toFixed(1)}px) translate(-50%, -50%)`;
  }

  private update(): void {
    if (!this.scene.activeCamera || (this.pinned.size === 0 && this.floating.length === 0)) return;
    const transform = this.scene.getTransformMatrix();
    const vw = this.engine.getRenderWidth();
    const vh = this.engine.getRenderHeight();
    const canvas = this.engine.getRenderingCanvas();
    const scaleX = canvas ? canvas.clientWidth / vw : 1;
    const scaleY = canvas ? canvas.clientHeight / vh : 1;
    for (const l of this.pinned.values()) this.project(l, transform, vw, vh, scaleX, scaleY);
    const now = performance.now();
    this.floating = this.floating.filter((l) => {
      if (now - l.born! > l.life!) {
        l.el.remove();
        return false;
      }
      this.project(l, transform, vw, vh, scaleX, scaleY);
      return true;
    });
  }
}
