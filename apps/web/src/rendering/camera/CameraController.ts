/**
 * CameraController (seção 14.3): posição, rotação, zoom e estado atual da câmera.
 *
 * Câmera tática do MVP (seção 14.1): inclinação fixa (~45°), rotação horizontal em passos
 * de 90° (quatro orientações), zoom limitado e pan pelo mapa. A câmera é exclusivamente
 * do cliente: nada aqui lê ou altera o estado da partida (seção 14.4).
 */
import { ArcRotateCamera, Vector3, type Scene } from '@babylonjs/core';
import type { CameraBounds } from './CameraBounds.js';
import { TRANSITION_RATES, damp } from './CameraTransitions.js';

/** Inclinação fixa: ângulo a partir da vertical (π/4 = 45° de elevação). */
const BETA = Math.PI / 4;
/** Orientação 0: câmera em +Z olhando para −Z (mesma leitura do mapa 2D do Lab). */
const BASE_ALPHA = Math.PI / 2;
const QUARTER = Math.PI / 2;

export type CameraOrientation = 0 | 90 | 180 | 270;

export class CameraController {
  readonly camera: ArcRotateCamera;
  /** Estado desejado; o estado da câmera Babylon persegue estes valores a cada quadro. */
  private desiredTarget: Vector3;
  private desiredAlpha = BASE_ALPHA;
  private desiredRadius: number;
  /** Passo de rotação acumulado (pode passar de 3 para a animação seguir o caminho curto). */
  private yawStep = 0;
  /** Foco amortecido sem o tremor (o tremor é somado só na câmera Babylon). */
  private smoothTarget: Vector3;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAmp = 0;
  private shakeTime = 0;

  constructor(
    scene: Scene,
    readonly bounds: CameraBounds,
    initialTarget: Vector3,
    initialRadius: number,
  ) {
    this.desiredTarget = initialTarget.clone();
    this.desiredRadius = bounds.clampRadius(initialRadius);
    this.smoothTarget = initialTarget.clone();
    this.camera = new ArcRotateCamera('tacticalCamera', BASE_ALPHA, BETA, this.desiredRadius, initialTarget.clone(), scene);
    this.camera.fov = 0.8;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 400;
    // Toda a entrada passa por CameraInput; os controles padrão do Babylon ficam desligados.
    this.camera.inputs.clear();
    this.camera.lowerBetaLimit = this.camera.upperBetaLimit = BETA;
    scene.activeCamera = this.camera;
  }

  /** Orientação atual (0°, 90°, 180°, 270°). */
  get orientation(): CameraOrientation {
    return ((((this.yawStep % 4) + 4) % 4) * 90) as CameraOrientation;
  }

  get radius(): number {
    return this.desiredRadius;
  }

  get target(): Vector3 {
    return this.desiredTarget.clone();
  }

  /** Vetor "para frente" no plano do chão (da câmera para o foco). */
  forward(): Vector3 {
    return new Vector3(-Math.cos(this.desiredAlpha), 0, -Math.sin(this.desiredAlpha));
  }

  /** Vetor "para a direita" da tela no plano do chão (sistema destro). */
  right(): Vector3 {
    return new Vector3(Math.sin(this.desiredAlpha), 0, -Math.cos(this.desiredAlpha));
  }

  /** Gira em passos de 90°: +1 = a câmera orbita no sentido horário, vista de cima (mapa com linha 0 no topo). */
  rotate(steps: number): void {
    this.yawStep += steps;
    this.desiredAlpha = BASE_ALPHA + this.yawStep * QUARTER;
  }

  /** Multiplica a distância (zoom). `factor` < 1 aproxima. */
  zoom(factor: number): void {
    this.desiredRadius = this.bounds.clampRadius(this.desiredRadius * factor);
  }

  setRadius(radius: number): void {
    this.desiredRadius = this.bounds.clampRadius(radius);
  }

  /** Desloca o foco no plano do chão, em metros (relativo à orientação da tela). */
  pan(rightMeters: number, forwardMeters: number): void {
    const d = this.right().scale(rightMeters).add(this.forward().scale(forwardMeters));
    this.setTarget(this.desiredTarget.add(d));
  }

  setTarget(p: Vector3): void {
    this.desiredTarget = new Vector3(this.bounds.clampX(p.x), p.y, this.bounds.clampZ(p.z));
  }

  /** Altura do foco (andar visualizado / andar do alvo). */
  setFocusHeight(y: number): void {
    this.desiredTarget = new Vector3(this.desiredTarget.x, y, this.desiredTarget.z);
  }

  /**
   * Para a transição em curso onde a câmera está agora (foco e zoom), sem salto: usado quando
   * o jogador interrompe a câmera automática (seção 14.12).
   */
  settle(): void {
    this.desiredTarget.copyFrom(this.smoothTarget);
    this.desiredRadius = this.bounds.clampRadius(this.camera.radius);
  }

  /** Salta direto para o estado desejado (ex.: reconexão, seção 14.14). */
  snap(): void {
    this.smoothTarget.copyFrom(this.desiredTarget);
    this.camera.target.copyFrom(this.desiredTarget);
    this.camera.alpha = this.desiredAlpha;
    this.camera.radius = this.desiredRadius;
  }

  /** Tremor leve da câmera (explosões). Não altera o foco desejado. */
  shake(amplitude: number, seconds: number): void {
    const current = this.shakeTotal > 0 ? this.shakeAmp * (this.shakeLeft / this.shakeTotal) : 0;
    if (current > amplitude) return;
    this.shakeAmp = amplitude;
    this.shakeLeft = this.shakeTotal = Math.max(0.05, seconds);
    this.shakeTime = 0;
  }

  /** Avança as transições; chamar uma vez por quadro. */
  update(dt: number): void {
    const cam = this.camera;
    const t = this.smoothTarget;
    t.set(
      damp(t.x, this.desiredTarget.x, TRANSITION_RATES.target, dt),
      damp(t.y, this.desiredTarget.y, TRANSITION_RATES.target, dt),
      damp(t.z, this.desiredTarget.z, TRANSITION_RATES.target, dt),
    );
    const target = t.clone();
    if (this.shakeLeft > 0) {
      // Tremor curto (explosões): ruído de senos decaindo, só na apresentação.
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      this.shakeTime += dt;
      const k = this.shakeAmp * (this.shakeLeft / this.shakeTotal);
      const w = this.shakeTime * 47;
      target.addInPlaceFromFloats(Math.sin(w) * k, Math.sin(w * 1.3 + 1) * k * 0.6, Math.sin(w * 0.9 + 2) * k);
    }
    cam.target = target;
    cam.alpha = damp(cam.alpha, this.desiredAlpha, TRANSITION_RATES.rotation, dt);
    cam.radius = damp(cam.radius, this.desiredRadius, TRANSITION_RATES.zoom, dt);
  }
}
