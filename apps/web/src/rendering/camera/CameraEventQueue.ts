/**
 * CameraEventQueue (seções 14.10–14.13): organiza focos automáticos durante habilidades,
 * impactos e explosões, a partir dos eventos de gameplay do core (o servidor nunca manda
 * "mova a câmera para X").
 *
 * TODO(fase 2, etapa de combate): consumir GameEvent[] → CameraShot[], tocar em sequência
 * com CameraFocus, permitir interrupção por entrada manual (`interrupt()`) e respeitar a
 * preferência Alta / Reduzida / Desativada.
 */
import type { Coord, EntityId } from '@bardurinho/domain';

export interface CameraShot {
  eventType: string;
  priority: number;
  targetEntity?: EntityId;
  targetCell?: Coord;
  durationHint: number;
  interruptible: boolean;
}

export type AutoCameraPreference = 'high' | 'reduced' | 'off';

export class CameraEventQueue {
  private queue: CameraShot[] = [];
  preference: AutoCameraPreference = 'high';

  enqueue(shot: CameraShot): void {
    this.queue.push(shot);
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /** Entrada manual interrompe a câmera automática (seção 14.12). */
  interrupt(): void {
    this.queue = this.queue.filter((s) => !s.interruptible);
  }

  get pending(): readonly CameraShot[] {
    return this.queue;
  }
}
