/**
 * CameraFocus (seção 14.3): focar personagem, célula, alvo ou evento.
 * Recebe coordenadas lógicas (x, y, floor) — nunca consulta regras.
 */
import { Vector3 } from '@babylonjs/core';
import type { Coord, GameMap } from '@bardurinho/domain';
import { CELL_SIZE, cellToWorld } from '../grid.js';
import type { CameraController } from './CameraController.js';

/** Distância padrão ao focar um personagem. */
export const FOCUS_RADIUS = 28;

export class CameraFocus {
  constructor(private readonly controller: CameraController) {}

  /** Centraliza na célula; mantém o zoom atual, a não ser que `radius` seja passado. */
  focusCell(c: Coord, radius?: number): void {
    const w = cellToWorld(c);
    this.controller.setTarget(new Vector3(w.x, w.y, w.z));
    if (radius !== undefined) this.controller.setRadius(radius);
  }

  /** Enquadra a arena inteira. */
  focusOverview(map: GameMap, radius: number): void {
    this.controller.setTarget(new Vector3((map.width * CELL_SIZE) / 2, 0, (map.height * CELL_SIZE) / 2));
    this.controller.setRadius(radius);
  }
}
