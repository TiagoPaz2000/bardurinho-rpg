/**
 * CameraEventQueue (seções 14.10–14.13): focos automáticos durante a reprodução dos eventos
 * de gameplay do core (o servidor nunca manda "mova a câmera para X"; o cliente decide).
 *
 * A reprodução (`rendering/eventPlayback.ts`) pede tomadas — seguir o personagem que anda,
 * enquadrar executor e alvo, abrir o enquadramento na explosão, focar a derrota, voltar ao
 * executor — e a fila decide o que roda:
 *
 * - **Prioridade e duração.** Cada tomada executada segura a câmera por `durationHint`
 *   segundos (no ritmo da reprodução: `update(dt)` recebe o tempo já escalado). Enquanto
 *   segura, tomadas de prioridade menor ficam adiadas (só a mais recente é guardada) e rodam
 *   quando a tomada termina; prioridade igual ou maior roda na hora. Assim a explosão
 *   (prioridade 2) não é cortada por um passo ou pelo retorno ao executor (prioridade 1).
 * - **Enquadramento.** `radius` abre/fecha o zoom (explosão: mais aberto); `'restore'`
 *   devolve o zoom de antes da reprodução (retorno ao controle).
 * - **Interrupção (14.12).** Entrada manual (`interrupt()`) descarta as tomadas
 *   interrompíveis, adiadas ou futuras, até a próxima reprodução (`begin()`): a câmera volta
 *   imediatamente ao jogador.
 * - **Preferência (14.13).** `high`: tudo. `reduced`: só eventos grandes (prioridade ≥ 2:
 *   explosões, derrotas), sem acompanhar passos, projéteis ou ataques simples. `off`: nada,
 *   exceto tomadas `essential` (início da partida, reconexão — seção 14.14).
 * - **Retorno ao controle** (`eventType: 'return.control'`): só roda se alguma tomada desta
 *   reprodução moveu a câmera (com `reduced`, depois de uma explosão; com `off`, nunca).
 *
 * Puramente visual: nada aqui afeta a resolução da partida.
 */
import type { Coord, EntityId } from '@bardurinho/domain';

export interface CameraShot {
  eventType: string;
  /** 1 = acompanhamento (passos, ataque simples) · 2 = evento grande (explosão, derrota). */
  priority: number;
  targetEntity?: EntityId;
  targetCell?: Coord;
  /** Quanto tempo a tomada segura a câmera (s, no ritmo da reprodução). */
  durationHint: number;
  interruptible: boolean;
  /** Distância da câmera (abrir o enquadramento) ou `'restore'` (zoom de antes da reprodução). */
  radius?: number | 'restore';
  /** Indispensável (início da partida, reconexão): roda mesmo com a preferência "Desativada". */
  essential?: boolean;
}

export type AutoCameraPreference = 'high' | 'reduced' | 'off';

export const RETURN_CONTROL = 'return.control';

export class CameraEventQueue {
  private interrupted = false;
  private time = 0;
  private holdUntil = 0;
  private holdPriority = 0;
  private deferred: CameraShot | null = null;
  /** Tomadas executadas na reprodução atual. */
  private ran = 0;
  /** Últimas tomadas executadas (depuração / capturas). */
  readonly history: CameraShot[] = [];
  preference: AutoCameraPreference = 'high';
  /** Executa uma tomada (ligado pela tela da arena ao CameraFocus). */
  runner: ((shot: CameraShot) => void) | null = null;
  /** Início de uma reprodução (a tela guarda o zoom para o `'restore'`). */
  onBegin: (() => void) | null = null;

  /** Início de uma reprodução de eventos: a câmera automática volta a valer. */
  begin(): void {
    this.interrupted = false;
    this.deferred = null;
    this.holdUntil = this.time;
    this.holdPriority = 0;
    this.ran = 0;
    this.onBegin?.();
  }

  /** A câmera automática foi interrompida pelo jogador nesta reprodução. */
  get isInterrupted(): boolean {
    return this.interrupted;
  }

  /** A câmera está presa a uma tomada agora. */
  get holding(): boolean {
    return this.time < this.holdUntil;
  }

  private allowed(shot: CameraShot): boolean {
    if (shot.essential) return true;
    if (this.preference === 'off') return false;
    if (this.interrupted && shot.interruptible) return false;
    if (shot.eventType === RETURN_CONTROL) return this.ran > 0;
    if (this.preference === 'reduced' && shot.priority < 2) return false;
    return true;
  }

  /** Pede uma tomada: roda na hora, fica adiada (câmera presa a algo mais importante) ou é descartada. */
  enqueue(shot: CameraShot): void {
    if (!this.allowed(shot)) return;
    if (this.holding && shot.priority < this.holdPriority && !shot.essential) {
      this.deferred = shot;
      return;
    }
    this.run(shot);
  }

  private run(shot: CameraShot): void {
    this.ran++;
    this.holdUntil = this.time + Math.max(0, shot.durationHint);
    this.holdPriority = shot.priority;
    this.history.push(shot);
    if (this.history.length > 20) this.history.shift();
    this.runner?.(shot);
  }

  /** Avança o relógio da fila (dt já no ritmo da reprodução); roda a tomada adiada quando a atual termina. */
  update(dt: number): void {
    this.time += dt;
    if (this.deferred && !this.holding) {
      const shot = this.deferred;
      this.deferred = null;
      if (this.allowed(shot)) this.run(shot);
    }
  }

  /** Entrada manual interrompe a câmera automática (seção 14.12). */
  interrupt(): void {
    this.interrupted = true;
    if (this.deferred?.interruptible) this.deferred = null;
    this.holdUntil = this.time;
    this.holdPriority = 0;
  }

  get pending(): readonly CameraShot[] {
    return this.deferred ? [this.deferred] : [];
  }
}
