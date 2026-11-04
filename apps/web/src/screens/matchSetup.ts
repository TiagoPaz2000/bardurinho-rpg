/**
 * Escolha de personagens (Fase 4): formato 1 × 1 ou 2 × 2 e, para cada personagem, classe,
 * acessório e até dois consumíveis de tipos diferentes (seções 2.1, 3.2, 3.3). Só monta um
 * `CharacterChoice[]` por equipe — quem valida é `normalizeChoice` (content) e as regras
 * continuam no core.
 *
 * - Partida local: `showLocalSetup` escolhe as duas equipes e recarrega a página com
 *   `?setup=<texto>&seed=<nova>` (o mesmo caminho de "Reiniciar").
 * - Rede: `TeamPicker` é embutido no lobby para a equipe do jogador.
 */
import { DEFAULT_CLASSES, DEFAULT_CONSUMABLES, MAX_START_CONSUMABLES, MAX_TEAM_SIZE, encodeSetup, normalizeChoice, type CharacterChoice, type MatchSetup, type TeamId } from '@bardurinho/content';
import type { Catalog } from '@bardurinho/domain';
import { abilityIcon, classIcon, iconImg, itemIcon } from './icons.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);


export function defaultChoice(team: TeamId, slot: number): CharacterChoice {
  return { classId: DEFAULT_CLASSES[team][slot] ?? 'warrior', accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] };
}

/** Editor de uma equipe (1–2 personagens). Mantém o próprio estado; `render()` devolve o HTML. */
export class TeamPicker {
  choices: CharacterChoice[];

  /**
   * `auto` (rede): a classe pode ficar "Automática" (`classId: ''`) — o servidor usa a padrão
   * da equipe do assento (A: Guerreiro, B: Mago), que só é conhecida depois de entrar.
   */
  constructor(
    private readonly catalog: Catalog,
    readonly team: TeamId,
    size = 1,
    private readonly title = `Equipe ${team}`,
    private readonly auto = false,
  ) {
    this.choices = Array.from({ length: size }, (_, i) => this.initial(i));
  }

  private initial(slot: number): CharacterChoice {
    return this.auto ? { classId: '', accessoryId: null, consumables: [...DEFAULT_CONSUMABLES] } : defaultChoice(this.team, slot);
  }

  setSize(size: number) {
    const n = Math.max(1, Math.min(MAX_TEAM_SIZE, size));
    while (this.choices.length < n) this.choices.push(this.initial(this.choices.length));
    this.choices.length = n;
  }

  /** Trata um clique dentro do editor; devolve true se mudou algo. */
  handle(el: HTMLElement): boolean {
    const d = el.dataset;
    if (d.team !== this.team) return false;
    const c = this.choices[Number(d.slot)];
    if (!c) return false;
    if (d.pick === 'class') c.classId = d.value ?? '';
    else if (d.pick === 'accessory') c.accessoryId = d.value || null;
    else if (d.pick === 'consumable' && d.value) {
      const list = c.consumables ?? [];
      if (list.includes(d.value)) c.consumables = list.filter((x) => x !== d.value);
      else c.consumables = [...list, d.value].slice(-MAX_START_CONSUMABLES);
    } else return false;
    const fixed = normalizeChoice(this.catalog, c, c.classId);
    this.choices[Number(d.slot)] = c.classId ? fixed : { ...fixed, classId: '' };
    return true;
  }

  render(): string {
    const cat = this.catalog;
    const items = Object.values(cat.items);
    const accessories = items.filter((i) => i.kind === 'accessory');
    const consumables = items.filter((i) => i.kind === 'consumable');
    const slots = this.choices.map((c, slot) => {
      const cls = cat.classes[c.classId];
      const armor = cls ? cat.items[cls.loadout.armor] : undefined;
      const attr = (pick: string, value: string, on: boolean) => `data-team="${this.team}" data-slot="${slot}" data-pick="${pick}" data-value="${esc(value)}" class="ms-opt${on ? ' on' : ''}"`;
      const acc = c.accessoryId ? cat.items[c.accessoryId] : undefined;
      const hp = (cls?.hp ?? 0) + (acc?.kind === 'accessory' ? (acc.maxHpBonus ?? 0) : 0);
      return `
        <div class="ms-slot" data-slot-box="${this.team}${slot}">
          <div class="ms-row ms-classes">${this.auto ? `<button type="button" ${attr('class', '', !c.classId)} title="Padrão da equipe do assento (A: Guerreiro/Ladino · B: Mago/Druida)"><span class="ms-auto">?</span><span>Automática</span></button>` : ''}${Object.values(cat.classes)
            .map((k) => `<button type="button" ${attr('class', k.id, k.id === c.classId)} title="${esc(k.name)}">${iconImg(classIcon(k.id), 'ms-icon')}<span>${esc(k.name)}</span></button>`)
            .join('')}</div>
          ${cls ? `<div class="ms-stats">PV ${hp} · PA ${cls.ap} · PM ${cls.mp} · Foco ${cls.maxFocus} · Armadura ${armor?.kind === 'armor' ? armor.armor : 0} (${esc(armor?.name ?? '')}) · Defesa ${cls.defense}</div>` : '<div class="ms-stats">Classe padrão da sua equipe (A: Guerreiro, Ladino · B: Mago, Druida)</div>'}
          <div class="ms-row ms-kit">${[...(cls?.loadout.weapons ?? []).map((w) => ({ icon: itemIcon(w), name: cat.items[w]?.name ?? w })), ...(cls?.loadout.abilities ?? []).map((a) => ({ icon: abilityIcon(a), name: cat.abilities[a]?.name ?? a }))]
            .map((k) => `<span class="ms-chip" title="${esc(k.name)}">${iconImg(k.icon, 'ms-icon-sm')}${esc(k.name)}</span>`)
            .join('')}</div>
          <div class="ms-label">Acessório</div>
          <div class="ms-row">
            <button type="button" ${attr('accessory', '', !c.accessoryId)}>Nenhum</button>
            ${accessories.map((a) => `<button type="button" ${attr('accessory', a.id, a.id === c.accessoryId)} title="${esc(a.name)}">${iconImg(itemIcon(a.id), 'ms-icon-sm')}${esc(a.name)}</button>`).join('')}
          </div>
          <div class="ms-label">Consumíveis (até ${MAX_START_CONSUMABLES}, tipos diferentes)</div>
          <div class="ms-row">${consumables
            .map((i) => `<button type="button" ${attr('consumable', i.id, (c.consumables ?? []).includes(i.id))} title="${esc(i.name)}">${iconImg(itemIcon(i.id), 'ms-icon-sm')}${esc(i.name)}</button>`)
            .join('')}</div>
        </div>`;
    });
    return `<div class="ms-team"><div class="ms-team-title team-${this.team}">${esc(this.title)}</div>${slots.join('')}</div>`;
  }
}

/** Tela de escolha da partida local (as duas equipes no mesmo navegador). */
export function showLocalSetup(root: HTMLElement, catalog: Catalog): Promise<MatchSetup> {
  const box = document.createElement('div');
  box.className = 'hud-lobby match-setup';
  root.append(box);
  let size = 1;
  const pickers = { A: new TeamPicker(catalog, 'A'), B: new TeamPicker(catalog, 'B') };
  return new Promise((resolve) => {
    const render = () => {
      box.innerHTML = `
        <div class="hud-panel lobby-box ms-box">
          <div class="lobby-title">Bardurinho RPG — nova partida local</div>
          <div class="lobby-sub">Pátio das Ruínas · você controla os dois lados</div>
          <div class="ms-row ms-format">
            <span class="ms-label">Formato</span>
            ${[1, 2].map((n) => `<button type="button" class="ms-opt${n === size ? ' on' : ''}" data-size="${n}">${n} × ${n}</button>`).join('')}
          </div>
          <div class="ms-teams">${pickers.A.render()}${pickers.B.render()}</div>
          <button type="button" class="hud-button ms-start" data-act="start">Começar partida</button>
          <div class="sub">Recarregar a página mantém a escolha (<code>?setup=</code>). <a href="?mode=rede">Partida em rede</a> · <a href="/">Jogo completo (conta)</a></div>
        </div>`;
    };
    box.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!el) return;
      if (el.dataset.size) {
        size = Number(el.dataset.size);
        pickers.A.setSize(size);
        pickers.B.setSize(size);
        return render();
      }
      if (el.dataset.act === 'start') {
        box.remove();
        return resolve({ teams: { A: pickers.A.choices, B: pickers.B.choices } });
      }
      if (pickers.A.handle(el) || pickers.B.handle(el)) render();
    });
    render();
  });
}

export { encodeSetup };
