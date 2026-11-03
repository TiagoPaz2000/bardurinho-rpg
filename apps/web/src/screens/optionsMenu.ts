/**
 * Tela de opções (etapa 6): abre com Esc (sem mira ativa) ou pelo botão "Opções" do HUD.
 *
 * - Câmera automática: Alta / Reduzida / Desativada (`CameraEventQueue.preference`);
 * - Ritmo das animações: Normal / Rápido (mesmo que a tecla T);
 * - Sensibilidade da câmera, inverter arrasto, inverter zoom, tremor nas explosões;
 * - Fase 4: volume dos efeitos sonoros (0 = mudo);
 * - Reiniciar a partida (mesma semente) / nova partida (semente nova).
 *
 * Guardado no navegador (settings.ts). Enquanto aberta, a partida não recebe teclas nem
 * cliques (o fundo cobre o canvas e a CameraInput é desligada).
 */
import type { AutoCameraPreference } from '../rendering/camera/index.js';
import type { ClientSettings } from './settings.js';

export interface OptionsMenuHandlers {
  /** Preferências mudaram (já normalizadas); quem chama aplica e guarda. */
  change: (s: ClientSettings) => void;
  setFast: (fast: boolean) => void;
  restart: () => void;
  newMatch: () => void;
  /** Abriu/fechou (desliga/religa a entrada da partida). */
  toggled?: (open: boolean) => void;
}

const AUTO_CAMERA: Array<{ value: AutoCameraPreference; label: string; hint: string }> = [
  { value: 'high', label: 'Alta', hint: 'acompanha passos, projéteis, alvos e explosões' },
  { value: 'reduced', label: 'Reduzida', hint: 'só momentos importantes (explosões, derrotas); retorno só se a câmera saiu' },
  { value: 'off', label: 'Desativada', hint: 'a câmera só se move pelos seus comandos' },
];

const volumeText = (v: number) => (v <= 0 ? 'mudo' : `${Math.round(v * 100)}%`);

export class OptionsMenu {
  readonly root: HTMLDivElement;
  private settings: ClientSettings;
  private fast: boolean;

  constructor(
    parent: HTMLElement,
    initial: ClientSettings,
    fast: boolean,
    private readonly handlers: OptionsMenuHandlers,
  ) {
    this.settings = { ...initial };
    this.fast = fast;
    this.root = document.createElement('div');
    this.root.className = 'hud-options';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    parent.append(this.root);
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.render();
    this.root.hidden = false;
    this.handlers.toggled?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.handlers.toggled?.(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** O ritmo também muda pela tecla T / botão do HUD. */
  setFast(fast: boolean): void {
    this.fast = fast;
    if (this.isOpen) this.render();
  }

  private update(patch: Partial<ClientSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.handlers.change(this.settings);
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    // Clique no fundo escuro fecha.
    if (t === this.root) return this.close();
    const btn = t.closest<HTMLElement>('[data-opt]');
    if (!btn) return;
    (btn as HTMLButtonElement).blur?.();
    const v = btn.dataset.value ?? '';
    switch (btn.dataset.opt) {
      case 'autoCamera':
        this.update({ autoCamera: v as AutoCameraPreference });
        break;
      case 'fast':
        this.fast = v === 'fast';
        this.handlers.setFast(this.fast);
        this.render();
        break;
      case 'invertDrag':
      case 'invertZoom':
      case 'cameraShake': {
        const key = btn.dataset.opt;
        this.update({ [key]: !this.settings[key] } as Partial<ClientSettings>);
        break;
      }
      case 'close':
        this.close();
        break;
      case 'restart':
        this.handlers.restart();
        break;
      case 'newMatch':
        this.handlers.newMatch();
        break;
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset.opt === 'sfxVolume') {
      this.settings = { ...this.settings, sfxVolume: Number(el.value) / 100 };
      this.handlers.change(this.settings);
      const out = this.root.querySelector('[data-vol-value]');
      if (out) out.textContent = volumeText(this.settings.sfxVolume);
      return;
    }
    if (el.dataset.opt !== 'sensitivity') return;
    this.settings = { ...this.settings, cameraSensitivity: Number(el.value) };
    this.handlers.change(this.settings);
    const out = this.root.querySelector('[data-sens-value]');
    if (out) out.textContent = `${this.settings.cameraSensitivity.toFixed(1)}×`;
  }

  private render(): void {
    const s = this.settings;
    const seg = (opt: string, items: Array<{ value: string; label: string; title?: string }>, current: string) =>
      `<div class="opt-seg">${items
        .map((i) => `<button type="button" data-opt="${opt}" data-value="${i.value}" class="${i.value === current ? 'on' : ''}"${i.title ? ` title="${i.title}"` : ''}>${i.label}</button>`)
        .join('')}</div>`;
    const check = (opt: keyof ClientSettings, label: string, on: boolean) =>
      `<button type="button" class="opt-check ${on ? 'on' : ''}" data-opt="${opt}"><span class="box">${on ? '✓' : ''}</span>${label}</button>`;
    const autoHint = AUTO_CAMERA.find((a) => a.value === s.autoCamera)?.hint ?? '';
    this.root.innerHTML = `
      <div class="hud-panel options-box" role="dialog" aria-label="Opções">
        <div class="opt-title">Opções</div>
        <div class="opt-row">
          <div class="opt-label">Câmera automática</div>
          ${seg('autoCamera', AUTO_CAMERA.map((a) => ({ value: a.value, label: a.label, title: a.hint })), s.autoCamera)}
          <div class="opt-hint">${autoHint}</div>
        </div>
        <div class="opt-row">
          <div class="opt-label">Ritmo das animações <kbd>T</kbd></div>
          ${seg('fast', [{ value: 'normal', label: 'Normal ▸' }, { value: 'fast', label: 'Rápido ▸▸' }], this.fast ? 'fast' : 'normal')}
        </div>
        <div class="opt-row">
          <div class="opt-label">Sensibilidade da câmera <span data-sens-value>${s.cameraSensitivity.toFixed(1)}×</span></div>
          <input type="range" min="0.5" max="2" step="0.1" value="${s.cameraSensitivity}" data-opt="sensitivity" aria-label="Sensibilidade da câmera" />
        </div>
        <div class="opt-row">
          <div class="opt-label">Volume dos efeitos sonoros <span data-vol-value>${volumeText(s.sfxVolume)}</span></div>
          <input type="range" min="0" max="100" step="5" value="${Math.round(s.sfxVolume * 100)}" data-opt="sfxVolume" aria-label="Volume dos efeitos sonoros" />
        </div>
        <div class="opt-row opt-checks">
          ${check('invertDrag', 'Inverter arrasto da câmera', s.invertDrag)}
          ${check('invertZoom', 'Inverter zoom (scroll)', s.invertZoom)}
          ${check('cameraShake', 'Tremor da câmera nas explosões', s.cameraShake)}
        </div>
        <div class="opt-actions">
          <button type="button" class="hud-button opt-secondary" data-opt="restart" title="Recomeça com a mesma semente dos dados">Reiniciar partida</button>
          <button type="button" class="hud-button opt-secondary" data-opt="newMatch" title="Recomeça com uma semente nova">Nova partida</button>
          <button type="button" class="hud-button" data-opt="close">Voltar ao jogo <kbd>Esc</kbd></button>
        </div>
        <div class="opt-hint">Preferências guardadas neste navegador.</div>
      </div>`;
  }
}
