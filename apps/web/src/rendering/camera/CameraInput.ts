/**
 * CameraInput (seção 14.2 / 14.3): teclado e mouse → comandos do CameraController.
 *
 * | Controle                        | Função                               |
 * |---------------------------------|--------------------------------------|
 * | WASD / setas                    | Pan pelo mapa (relativo à tela)      |
 * | Q / E                           | Girar em passos de 90°               |
 * | Scroll                          | Zoom (limitado)                      |
 * | Botão do meio ou direito + arrastar | Pan alternativo                  |
 * | F                               | Recentrar no personagem ativo (callback) |
 *
 * O clique esquerdo fica livre para a seleção (próxima etapa). Futuro: gamepad.
 */
import type { CameraController } from './CameraController.js';

/** Velocidade do pan por teclado, em frações da distância da câmera por segundo. */
const KEY_PAN_SPEED = 0.9;
const WHEEL_ZOOM_STEP = 1.12;

export interface CameraInputActions {
  /** F: recentrar no personagem ativo. */
  focusActive?: () => void;
  /** Chamado em qualquer entrada manual (interrompe câmera automática, seção 14.12). */
  onManualInput?: () => void;
}

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class CameraInput {
  private readonly held = new Set<string>();
  private drag: { x: number; y: number; pointerId: number } | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly controller: CameraController,
    private readonly canvas: HTMLCanvasElement,
    private readonly actions: CameraInputActions = {},
  ) {
    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.held.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.held.clear());
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(canvas, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(canvas, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(canvas, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (PAN_KEYS[e.code]) {
      this.held.add(e.code);
      this.actions.onManualInput?.();
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      // A interrupção vem antes da ação: a câmera automática para onde está e só então
      // a entrada manual é aplicada (seção 14.12).
      case 'KeyQ':
        this.actions.onManualInput?.();
        this.controller.rotate(-1);
        break;
      case 'KeyE':
        this.actions.onManualInput?.();
        this.controller.rotate(1);
        break;
      case 'KeyF':
        this.actions.focusActive?.();
        break;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const notches = Math.max(-3, Math.min(3, e.deltaY / 100));
    this.actions.onManualInput?.();
    this.controller.zoom(Math.pow(WHEEL_ZOOM_STEP, notches));
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    this.drag = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    // Metros por pixel na distância atual (aproximação suficiente para o pan "agarrar" o chão).
    const cam = this.controller.camera;
    const mpp = (2 * cam.radius * Math.tan(cam.fov / 2)) / Math.max(1, this.canvas.clientHeight);
    this.actions.onManualInput?.();
    this.controller.pan(-dx * mpp, dy * mpp * Math.SQRT2);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.drag?.pointerId === e.pointerId) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.drag = null;
    }
  }

  /** Aplica o pan contínuo das teclas pressionadas; chamar uma vez por quadro. */
  update(dt: number): void {
    let rx = 0;
    let fz = 0;
    for (const code of this.held) {
      const v = PAN_KEYS[code];
      if (v) {
        rx += v[0];
        fz += v[1];
      }
    }
    if (rx === 0 && fz === 0) return;
    const len = Math.hypot(rx, fz);
    const speed = KEY_PAN_SPEED * this.controller.radius * dt;
    this.controller.pan((rx / len) * speed, (fz / len) * speed);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
