/**
 * Barras sobre os personagens (etapa 3): PV (+ barreira) e estados, em HTML preso acima da
 * cabeça (`WorldLabels.pinHtml`, segue o modelo durante a animação). Atualizadas no `sync`
 * com o estado oficial e, durante a reprodução, pelos eventos de dano/cura/barreira
 * (`patch`), para a barra cair junto com o número flutuante.
 *
 * Sem névoa de guerra ainda: todos os personagens vivos mostram a barra.
 */
import { Vector3 } from '@babylonjs/core';
import type { Catalog, GameState, Unit } from '@bardurinho/domain';
import type { ArenaView } from './ArenaView.js';
import type { WorldLabels } from './worldLabels.js';
import { iconImg, statusIcon } from '../screens/icons.js';

interface BarData {
  name: string;
  team: string;
  hp: number;
  maxHp: number;
  shield: number;
  /** Estados com ícone e turnos restantes (Fase 4: feedback de estados). */
  statuses: Array<{ id: string; text: string }>;
  active: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const key = (id: string) => `unit-bar:${id}`;

export class UnitStatusBars {
  private readonly data = new Map<string, BarData>();

  constructor(
    private readonly arena: ArenaView,
    private readonly labels: WorldLabels,
    private readonly catalog: Catalog,
  ) {}

  /** Reflete o estado oficial (vivos ganham barra; derrotados perdem). */
  sync(state: GameState): void {
    for (const u of Object.values(state.units)) {
      if (!u.alive) {
        this.data.delete(u.id);
        this.labels.unpin(key(u.id));
        continue;
      }
      this.data.set(u.id, this.fromUnit(u, state.turn.activeUnitId === u.id));
      this.render(u.id);
    }
    for (const id of [...this.data.keys()]) if (!state.units[id]) (this.data.delete(id), this.labels.unpin(key(id)));
  }

  /** Atualização parcial durante a reprodução dos eventos (ex.: PV após o dano). */
  patch(unitId: string, change: Partial<Pick<BarData, 'hp' | 'shield'>> & { defeated?: boolean }): void {
    const d = this.data.get(unitId);
    if (!d) return;
    if (change.defeated) {
      this.data.delete(unitId);
      this.labels.unpin(key(unitId));
      return;
    }
    Object.assign(d, change.hp !== undefined ? { hp: change.hp } : {}, change.shield !== undefined ? { shield: change.shield } : {});
    this.render(unitId);
  }

  private fromUnit(u: Unit, active: boolean): BarData {
    return {
      name: u.name && u.name !== u.id ? u.name : (u.classId ? (this.catalog.classes[u.classId]?.name ?? u.classId) : 'Boneco'),
      team: u.team,
      hp: u.hp,
      maxHp: u.maxHp,
      shield: u.shield?.amount ?? 0,
      statuses: u.statuses.map((s) => {
        const def = this.catalog.statuses[s.statusId];
        const turns = def?.duration.kind !== 'manual' && s.remaining > 0 ? ` ${s.remaining}` : '';
        return { id: s.statusId, text: `${def?.name ?? s.statusId}${turns}` };
      }),
      active,
    };
  }

  private render(id: string): void {
    const d = this.data.get(id);
    if (!d) return;
    // A barra cobre PV máximos + barreira, para a barreira aparecer como extensão azul.
    const total = Math.max(1, d.maxHp + d.shield);
    const hpPct = (Math.max(0, d.hp) / total) * 100;
    const shPct = (d.shield / total) * 100;
    const low = d.hp / Math.max(1, d.maxHp) <= 0.3 ? ' low' : '';
    const html = `
      <div class="ub-name team-${esc(d.team)}">${esc(d.name)}</div>
      <div class="ub-bar${low}"><div class="ub-hp" style="width:${hpPct.toFixed(1)}%"></div><div class="ub-shield" style="left:${hpPct.toFixed(1)}%;width:${shPct.toFixed(1)}%"></div></div>
      <div class="ub-text">${d.hp}/${d.maxHp}${d.shield ? ` <span class="ub-sh">+${d.shield}</span>` : ''}</div>
      ${d.statuses.length || d.shield ? `<div class="ub-status">${d.shield ? `<span class="ub-st">${iconImg(statusIcon('barrier'), '', 'Barreira')}${d.shield}</span>` : ''}${d.statuses.map((s) => `<span class="ub-st" data-status="${esc(s.id)}">${iconImg(statusIcon(s.id), '', s.text)}${esc(s.text)}</span>`).join('')}</div>` : ''}`;
    this.labels.pinHtml(key(id), html, () => this.anchor(id), `unit-bar${d.active ? ' active' : ''}`);
  }

  private anchor(id: string): Vector3 | null {
    const view = this.arena.unitView(id);
    if (!view || !view.root.isEnabled()) return null;
    const h = view.headPosition();
    return new Vector3(h.x, h.y + 0.55, h.z);
  }
}
