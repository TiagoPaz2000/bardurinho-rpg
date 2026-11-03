/**
 * HUD mínimo (HTML sobre o canvas): nome do mapa, rodada/personagem ativo, andar
 * visualizado e ajuda dos controles de câmera. A interface de combate vem na etapa 3.
 */
import type { Catalog, GameState } from '@bardurinho/domain';

export interface HudView {
  mapName: string;
  state: GameState;
  viewedFloor: number;
  floors: number;
  orientation: number;
  radius: number;
  grid: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const floorLabel = (floor: number, floors: number): string =>
  floor === 0 ? 'térreo' : floor === floors - 1 ? 'plataformas' : `andar ${floor}`;

export class Hud {
  private readonly info: HTMLDivElement;
  private last = '';

  constructor(
    root: HTMLElement,
    private readonly catalog: Catalog,
  ) {
    root.innerHTML = '';
    this.info = document.createElement('div');
    this.info.className = 'hud-panel hud-info';
    const help = document.createElement('div');
    help.className = 'hud-panel hud-help';
    help.innerHTML = `
      <table>
        <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / setas</td><td>mover a câmera</td></tr>
        <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>girar 90°</td></tr>
        <tr><td>scroll</td><td>zoom</td></tr>
        <tr><td>botão do meio / direito + arrastar</td><td>mover a câmera</td></tr>
        <tr><td><kbd>F</kbd></td><td>focar personagem ativo</td></tr>
        <tr><td><kbd>PgUp</kbd> <kbd>PgDn</kbd> / <kbd>1</kbd> <kbd>2</kbd></td><td>andar visualizado</td></tr>
        <tr><td><kbd>G</kbd></td><td>grade de debug</td></tr>
        <tr><td><kbd>Home</kbd></td><td>visão geral da arena</td></tr>
      </table>`;
    root.append(this.info, help);
  }

  update(v: HudView): void {
    const { state } = v;
    const active = state.turn.activeUnitId ? state.units[state.turn.activeUnitId] : undefined;
    const className = active?.classId ? (this.catalog.classes[active.classId]?.name ?? active.classId) : '—';
    const activeHtml = active
      ? `<span class="team-${esc(active.team)}">${esc(active.name)}</span> (${esc(className)}, equipe ${esc(active.team)})`
      : '—';
    const html = `
      <div class="map">${esc(v.mapName)}</div>
      <div class="row"><span class="label">Rodada</span><span>${state.turn.round}</span></div>
      <div class="row"><span class="label">Vez de</span><span>${activeHtml}</span></div>
      <div class="row"><span class="label">Andar visualizado</span><span>${v.viewedFloor} — ${floorLabel(v.viewedFloor, v.floors)}${v.viewedFloor === v.floors - 1 ? ' (tudo visível)' : ''}</span></div>
      <div class="row"><span class="label">Câmera</span><span>${v.orientation}° · ${v.radius.toFixed(0)} m${v.grid ? ' · grade' : ''}</span></div>`;
    if (html !== this.last) {
      this.last = html;
      this.info.innerHTML = html;
    }
  }
}
