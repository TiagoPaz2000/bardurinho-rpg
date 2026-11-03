/**
 * CameraEventQueue (seções 14.10–14.13): focos automáticos durante a reprodução dos eventos
 * de gameplay do core (o servidor nunca manda "mova a câmera para X").
 *
 * Etapa 3 (mínimo): a reprodução (`rendering/eventPlayback.ts`) pede tomadas — seguir o
 * personagem que anda, focar o alvo do ataque, voltar ao executor — e a fila as executa na
 * hora pelo `runner` (CameraFocus). Entrada manual (`interrupt()`) cancela as tomadas
 * interrompíveis até a próxima reprodução (`begin()`), devolvendo a câmera ao jogador
 * (seção 14.12). Preferência "Desativada" ignora tudo; "Reduzida" só aceita prioridade ≥ 2.
 *
 * TODO: tomadas com duração própria e enquadramento de explosões (abrir o zoom).
 */
import type { Coord, EntityId } from '@bardurinho/domain';

export interface CameraShot {
  eventType: string;
  /** 1 = acompanhamento (passos, ataque simples) · 2 = evento grande (explosão, derrota). */
  priority: number;
  targetEntity?: EntityId;
  targetCell?: Coord;
  durationHint: number;
  interruptible: boolean;
}

export type AutoCameraPreference = 'high' | 'reduced' | 'off';

export class CameraEventQueue {
  private queue: CameraShot[] = [];
  private interrupted = false;
  preference: AutoCameraPreference = 'high';
  /** Executa uma tomada (ligado pela tela da arena ao CameraFocus). */
  runner: ((shot: CameraShot) => void) | null = null;

  /** Início de uma reprodução de eventos: a câmera automática volta a valer. */
  begin(): void {
    this.interrupted = false;
    this.queue = [];
  }

  /** A câmera automática foi interrompida pelo jogador nesta reprodução. */
  get isInterrupted(): boolean {
    return this.interrupted;
  }

  /** Pede uma tomada; executa na hora se permitida (preferência e interrupção). */
  enqueue(shot: CameraShot): void {
    if (this.preference === 'off') return;
    if (this.preference === 'reduced' && shot.priority < 2) return;
    if (this.interrupted && shot.interruptible) return;
    this.queue.push(shot);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.flush();
  }

  private flush(): void {
    while (this.queue.length) {
      const shot = this.queue.shift()!;
      this.runner?.(shot);
    }
  }

  /** Entrada manual interrompe a câmera automática (seção 14.12). */
  interrupt(): void {
    this.interrupted = true;
    this.queue = this.queue.filter((s) => !s.interruptible);
  }

  get pending(): readonly CameraShot[] {
    return this.queue;
  }
}
