/**
 * Efeitos sonoros principais (Fase 4), sintetizados na hora com WebAudio — sem arquivos.
 * Cada som é uma receita de camadas (oscilador com varredura de frequência ou ruído
 * filtrado, com envelope). Como os efeitos visuais, só reage a eventos aceitos do core:
 * `soundsForEvent` (pura, testada em tests/unit/sfx.test.ts) diz o que tocar.
 *
 * Volume na tela de opções (`settings.sfxVolume`, 0 = mudo). O contexto de áudio só pode
 * começar depois de um gesto do usuário: é retomado no primeiro clique/tecla.
 * Depuração: `window.__sfx.played` guarda os últimos sons pedidos (o e2e confere).
 */
import { catalog } from '@bardurinho/content';
import type { GameEvent } from '@bardurinho/domain';

interface Layer {
  kind: 'osc' | 'noise';
  wave?: OscillatorType;
  /** Frequência inicial → final (Hz); no ruído, a do filtro. */
  f0: number;
  f1?: number;
  filter?: BiquadFilterType;
  q?: number;
  /** Duração (s), atraso (s) e ganho de pico. */
  dur: number;
  delay?: number;
  gain: number;
  /** Ataque (s). */
  attack?: number;
}

const osc = (wave: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, attack = 0.005): Layer => ({ kind: 'osc', wave, f0, f1, dur, gain, delay, attack });
const noise = (filter: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, delay = 0, q = 1, attack = 0.004): Layer => ({ kind: 'noise', filter, f0, f1, dur, gain, delay, q, attack });

/** Receitas (ids estáveis: o e2e e os testes os usam). */
export const SOUNDS: Record<string, Layer[]> = {
  'ui.click': [osc('square', 900, 700, 0.05, 0.12)],
  'ui.error': [osc('square', 220, 160, 0.16, 0.12), osc('square', 180, 120, 0.16, 0.1, 0.09)],
  'turn.start': [osc('triangle', 523, 523, 0.12, 0.16), osc('triangle', 784, 784, 0.18, 0.14, 0.09)],
  step: [noise('lowpass', 500, 260, 0.07, 0.18)],
  'swing.melee': [noise('bandpass', 900, 2600, 0.16, 0.22, 0, 1.4)],
  'bow.release': [osc('triangle', 180, 90, 0.12, 0.2), noise('highpass', 3000, 5000, 0.1, 0.1)],
  'cast.fire': [noise('bandpass', 400, 1600, 0.35, 0.28, 0, 0.8, 0.05), osc('sawtooth', 110, 220, 0.3, 0.06)],
  'cast.frost': [osc('sine', 1800, 2600, 0.3, 0.12, 0, 0.02), osc('sine', 2400, 3300, 0.25, 0.08, 0.05), noise('highpass', 4000, 6000, 0.3, 0.08)],
  'cast.arcane': [osc('sine', 440, 880, 0.3, 0.16, 0, 0.03), osc('triangle', 660, 1320, 0.3, 0.08, 0.04)],
  'cast.nature': [osc('triangle', 300, 520, 0.28, 0.14, 0, 0.03), noise('bandpass', 1200, 900, 0.25, 0.08)],
  'cast.self': [osc('sine', 330, 660, 0.4, 0.14, 0, 0.08), osc('sine', 495, 990, 0.4, 0.08, 0.05, 0.08)],
  'impact.physical': [noise('lowpass', 1800, 300, 0.14, 0.4), osc('square', 140, 60, 0.1, 0.12)],
  'impact.fire': [noise('bandpass', 900, 300, 0.3, 0.35, 0, 0.7)],
  'impact.cold': [noise('highpass', 3500, 2200, 0.2, 0.25), osc('sine', 2200, 1800, 0.18, 0.1)],
  'impact.arcane': [osc('sine', 880, 330, 0.22, 0.2), noise('bandpass', 2000, 800, 0.15, 0.1)],
  'impact.nature': [noise('bandpass', 700, 400, 0.2, 0.3, 0, 1.2), osc('triangle', 200, 120, 0.15, 0.12)],
  'impact.blocked': [osc('triangle', 1200, 900, 0.18, 0.18), osc('sine', 2400, 1800, 0.12, 0.08)],
  miss: [noise('bandpass', 1500, 600, 0.22, 0.18, 0, 2)],
  crit: [osc('square', 660, 660, 0.08, 0.12), osc('square', 990, 990, 0.12, 0.12, 0.07)],
  heal: [osc('sine', 523, 523, 0.3, 0.12, 0, 0.03), osc('sine', 659, 659, 0.3, 0.1, 0.08, 0.03), osc('sine', 784, 784, 0.4, 0.1, 0.16, 0.03)],
  'focus.restore': [osc('sine', 740, 1480, 0.35, 0.12, 0, 0.04), osc('sine', 988, 1976, 0.3, 0.06, 0.08)],
  'shield.up': [osc('sine', 220, 440, 0.4, 0.16, 0, 0.06), osc('triangle', 440, 880, 0.35, 0.06, 0.04)],
  'shield.down': [osc('sine', 600, 200, 0.3, 0.12)],
  explosion: [noise('lowpass', 1200, 80, 0.9, 0.6, 0, 0.7, 0.002), osc('sine', 90, 30, 0.7, 0.35)],
  ignite: [noise('bandpass', 600, 2200, 0.4, 0.25, 0, 0.7, 0.06)],
  extinguish: [noise('highpass', 2500, 5000, 0.45, 0.2, 0, 0.7, 0.03)],
  water: [noise('lowpass', 1600, 400, 0.6, 0.3, 0, 1, 0.02), osc('sine', 500, 260, 0.2, 0.08, 0.05)],
  oil: [noise('lowpass', 500, 200, 0.3, 0.25, 0, 2)],
  thorns: [noise('bandpass', 2500, 1200, 0.25, 0.2, 0, 3), osc('sawtooth', 180, 240, 0.2, 0.05)],
  roots: [osc('sawtooth', 90, 60, 0.4, 0.1, 0, 0.05), noise('lowpass', 400, 200, 0.4, 0.18)],
  stealth: [noise('highpass', 1800, 600, 0.5, 0.14, 0, 0.7, 0.12)],
  'stealth.reveal': [osc('triangle', 300, 600, 0.2, 0.12)],
  push: [noise('lowpass', 900, 200, 0.3, 0.35), osc('sine', 120, 70, 0.25, 0.2)],
  charge: [noise('lowpass', 700, 300, 0.4, 0.25, 0, 1, 0.08)],
  'status.burning': [noise('bandpass', 800, 1400, 0.3, 0.16, 0, 0.8, 0.04)],
  'status.slowed': [osc('sine', 600, 300, 0.35, 0.12)],
  'status.end': [osc('triangle', 500, 400, 0.12, 0.08)],
  door: [osc('sawtooth', 120, 90, 0.35, 0.08, 0, 0.05), noise('lowpass', 600, 300, 0.25, 0.12, 0.1)],
  lever: [osc('square', 300, 200, 0.08, 0.12), noise('lowpass', 1200, 500, 0.15, 0.15, 0.06)],
  chest: [osc('triangle', 660, 660, 0.1, 0.12), osc('triangle', 880, 880, 0.15, 0.12, 0.08), osc('triangle', 1320, 1320, 0.2, 0.1, 0.16)],
  'wood.break': [noise('lowpass', 2000, 300, 0.4, 0.4, 0, 1.2), osc('square', 160, 80, 0.15, 0.1)],
  defeat: [osc('sawtooth', 330, 110, 0.6, 0.12), osc('sine', 220, 70, 0.6, 0.14, 0.05)],
  'match.end': [osc('triangle', 523, 523, 0.18, 0.14), osc('triangle', 659, 659, 0.18, 0.14, 0.16), osc('triangle', 784, 784, 0.4, 0.14, 0.32)],
};

const CAST_BY_VFX: Record<string, string> = {
  'projectile.fire': 'cast.fire',
  'projectile.fireball': 'cast.fire',
  'projectile.frost': 'cast.frost',
  'projectile.arcane': 'cast.arcane',
  'projectile.nature': 'cast.nature',
  'surface.thorns': 'thorns',
  'status.roots': 'roots',
  'trail.arrow': 'bow.release',
  'impact.physical': 'swing.melee',
  'impact.wave': 'push',
  'charge.dust': 'charge',
  'barrier.arcane': 'cast.self',
  'stealth.transition': 'stealth',
  'heal.nature': 'cast.self',
};
const CAST_BY_ITEM: Record<string, string> = {
  'consumable.health_potion': 'cast.self',
  'consumable.focus_potion': 'cast.self',
  'consumable.oil_flask': 'oil',
};

/** Sons de um evento aceito (pura: sem WebAudio). */
export function soundsForEvent(ev: GameEvent): string[] {
  const p = ev.payload;
  switch (ev.type) {
    case 'UNIT_MOVED':
    case 'FORCED_MOVE':
      return ['step'];
    case 'ABILITY_USED': {
      const vfx = catalog.abilities[String(p.abilityId)]?.presentation?.vfxId;
      return [CAST_BY_VFX[vfx ?? ''] ?? 'cast.arcane'];
    }
    case 'ATTACK_PERFORMED': {
      const w = catalog.items[String(p.weaponId)];
      const vfx = w?.kind === 'weapon' ? w.presentation?.vfxId : undefined;
      return [CAST_BY_VFX[vfx ?? ''] ?? 'swing.melee'];
    }
    case 'ITEM_USED':
      return [CAST_BY_ITEM[String(p.itemId)] ?? 'ui.click'];
    case 'ATTACK_ROLLED':
      return p.critical ? ['crit'] : p.hit ? [] : ['miss'];
    case 'DAMAGE_APPLIED': {
      if (Number(p.hpDamage) > 0) return [`impact.${String(p.damageType)}` in SOUNDS ? `impact.${String(p.damageType)}` : 'impact.physical'];
      return ['impact.blocked'];
    }
    case 'OBJECT_DAMAGED':
      return [`impact.${String(p.damageType)}` in SOUNDS ? `impact.${String(p.damageType)}` : 'impact.physical'];
    case 'OBJECT_DESTROYED':
      return String(p.defId) === 'barrel' ? [] : ['wood.break'];
    case 'EXPLOSION':
      return ['explosion'];
    case 'HEALED':
      return Number(p.effective ?? 1) > 0 ? ['heal'] : [];
    case 'RESOURCE_RESTORED':
      return Number(p.after) > Number(p.before) ? ['focus.restore'] : [];
    case 'SHIELD_GRANTED':
      return p.applied ? ['shield.up'] : [];
    case 'SHIELD_EXPIRED':
      return ['shield.down'];
    case 'STATUS_APPLIED':
    case 'STATUS_REFRESHED': {
      const id = String(p.statusId);
      return id === 'burning' ? ['status.burning'] : id === 'slowed' ? ['status.slowed'] : id === 'rooted' ? ['roots'] : id === 'hidden' ? [] : ['status.end'];
    }
    case 'STATUS_REMOVED':
    case 'STATUS_EXPIRED':
      return String(p.statusId) === 'hidden' ? ['stealth.reveal'] : ['status.end'];
    case 'SURFACE_CREATED':
      return p.refreshed ? [] : p.surface === 'fire' ? ['ignite'] : p.surface === 'oil' ? ['oil'] : ['thorns'];
    case 'SURFACE_REMOVED':
      return p.surface === 'fire' ? ['extinguish'] : [];
    case 'STIMULUS_EMITTED':
      return p.stimulus === 'water' ? ['water'] : [];
    case 'OBJECT_IGNITED':
      return ['ignite'];
    case 'OBJECT_EXTINGUISHED':
      return ['extinguish'];
    case 'OBJECT_STATE_CHANGED': {
      const id = String(p.objectId);
      return id.startsWith('lever') ? ['lever'] : id.startsWith('chest') ? ['chest'] : id.startsWith('door') || id.startsWith('gate') ? ['door'] : ['ui.click'];
    }
    case 'CONSUMABLE_GRANTED':
      return ['chest'];
    case 'UNIT_DEFEATED':
      return ['defeat'];
    case 'TURN_STARTED':
      return ['turn.start'];
    case 'MATCH_ENDED':
      return ['match.end'];
    default:
      return [];
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private vol = 0.6;
  /** Últimos sons pedidos (depuração / e2e), com o número de vezes de cada id. */
  readonly played: string[] = [];
  readonly counts: Record<string, number> = {};
  /** Sons tocados de fato (com o contexto de áudio rodando). */
  audible = 0;
  /** Limite de vozes simultâneas por id num intervalo curto (evita "metralhadora"). */
  private lastAt = new Map<string, number>();

  constructor() {
    const unlock = () => this.resume();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get volume(): number {
    return this.vol;
  }
  set volume(v: number) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.vol;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      // Ruído determinístico (LCG), igual em toda execução.
      let s = 12345;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (s / 0x3fffffff - 1) * 0.9;
      }
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** Toca os sons de um evento aceito. */
  event(ev: GameEvent): void {
    for (const id of soundsForEvent(ev)) this.play(id);
  }

  play(id: string): void {
    const recipe = SOUNDS[id];
    if (!recipe) return;
    this.played.push(id);
    if (this.played.length > 400) this.played.splice(0, this.played.length - 400);
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    if (this.vol <= 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if ((this.lastAt.get(id) ?? -1) > now - 0.04) return;
    this.lastAt.set(id, now);
    this.audible++;
    for (const l of recipe) this.layer(ctx, l, now + (l.delay ?? 0));
  }

  private layer(ctx: AudioContext, l: Layer, t0: number): void {
    const g = ctx.createGain();
    const attack = Math.min(l.attack ?? 0.005, l.dur / 2);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + l.dur);
    g.connect(this.master!);
    const end = t0 + l.dur + 0.02;
    if (l.kind === 'osc') {
      const o = ctx.createOscillator();
      o.type = l.wave ?? 'sine';
      o.frequency.setValueAtTime(l.f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, l.f1 ?? l.f0), t0 + l.dur);
      o.connect(g);
      o.start(t0);
      o.stop(end);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = l.filter ?? 'lowpass';
    f.Q.value = l.q ?? 1;
    f.frequency.setValueAtTime(l.f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, l.f1 ?? l.f0), t0 + l.dur);
    src.connect(f);
    f.connect(g);
    src.start(t0, Math.random() * 0.5);
    src.stop(end);
  }
}
