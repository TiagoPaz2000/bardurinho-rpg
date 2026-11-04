/**
 * Bot (seção 13): escolhe o próximo comando do personagem da vez a partir da **visão da sua
 * equipe** (o estado projetado que o servidor mandaria a um jogador). Usa só o core:
 * `applyCommand` em simulação para conhecer as consequências (dano, estados, superfícies,
 * reações em cadeia, explosões), as mesmas pré-condições dos jogadores e o mesmo formato de
 * comando. Não altera PV, não ignora custo, não conhece posições ocultas e não executa ações
 * inválidas — o comando escolhido ainda passa pela validação normal do servidor.
 *
 * Níveis:
 * - **easy** — avalia só ações imediatas, supõe que todo ataque com d20 médio acerta/erra
 *   (sem chance de acerto), considera poucos movimentos e às vezes escolhe uma ação válida ao
 *   acaso ou encerra o turno cedo ("pode escolher opções inferiores").
 * - **normal** — compara dano esperado (chance de acerto × dano), cura, barreira, estados,
 *   posição (alcance/linha de visão/aproximação) e ambiente (o core simula óleo, fogo, barris).
 * - **hard** — examina sequências do turno (beam sobre as melhores ações, completando de forma
 *   gulosa) e desconta a resposta provável do adversário (ameaça no próximo turno dele).
 */
import {
  applyCommand,
  attackHitChance,
  coordKey,
  crossArea,
  distance,
  getCell,
  hasLineOfSight,
  reachableCells,
  unitAt,
  type Catalog,
  type CommandTarget,
  type Coord,
  type GameplayCommand,
  type GameState,
  type Unit,
} from '@bardurinho/domain';
import { evaluate, positionScore, threatAgainst, travelField, unitReach, WEIGHTS, type EvalContext, type Field } from './evaluate.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

export interface BotOptions {
  difficulty: BotDifficulty;
  /** Semente do sorteio do bot (reprodutível). */
  seed?: number;
  /** Para onde ir quando nenhum inimigo está à vista (ex.: pontos de início do adversário). */
  explore?: Coord[];
}

export interface ScoredOption {
  label: string;
  command: GameplayCommand;
  setup?: boolean;
  score: number;
}

export interface BotDecision {
  command: GameplayCommand;
  label: string;
  score: number;
  /** Opções avaliadas (melhores primeiro) — painel "AI" do Lab / depuração. */
  considered: ScoredOption[];
}

const DIFFICULTY = {
  easy: { moves: 3, randomMoves: 3, expected: false, randomPick: 0.3, earlyEnd: 0.15, beam: 0, depth: 0, threat: false },
  normal: { moves: 8, randomMoves: 0, expected: true, randomPick: 0, earlyEnd: 0, beam: 0, depth: 0, threat: false },
  hard: { moves: 10, randomMoves: 0, expected: true, randomPick: 0, earlyEnd: 0, beam: 4, depth: 2, threat: true },
} as const;

/** Máximo de comandos do bot num turno (segurança; cada ação gasta PA ou PM). */
export const MAX_COMMANDS_PER_TURN = 12;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const commandKey = (c: GameplayCommand): string => JSON.stringify(c, Object.keys(c).sort());

const cellTarget = (c: Coord): CommandTarget => ({ kind: 'cell', x: c.x, y: c.y, floor: c.floor });

interface Candidate {
  label: string;
  command: GameplayCommand;
  /** Jogada de ataque contra um personagem: valor esperado = p·acerto + (1−p)·erro. */
  roll?: { p: number };
  bonus?: number;
  /** Movimento até uma posição de ataque (raiz extra do planejamento do bot difícil). */
  setup?: boolean;
}

export class BotBrain {
  readonly difficulty: BotDifficulty;
  private readonly rand: () => number;
  private readonly lastSeen = new Map<string, Coord>();
  private turnKey = '';
  private commandsThisTurn = 0;
  private readonly rejected = new Set<string>();
  /** Pontos de exploração ainda não visitados (prioridade: os do adversário; depois uma malha do mapa). */
  private waypoints: Coord[] | null = null;
  private ownTurns = 0;
  /** Destinos de movimento recusados pelo servidor (célula → até qual turno próprio evitar). */
  private readonly blockedMoves = new Map<string, number>();

  constructor(
    private readonly catalog: Catalog,
    readonly team: string,
    private readonly options: BotOptions,
  ) {
    this.difficulty = options.difficulty;
    this.rand = mulberry32(options.seed ?? 1);
  }

  /** O servidor recusou o comando (ex.: um inimigo oculto bloqueou o caminho): não repete neste turno. */
  rejectedCommand(command: GameplayCommand): void {
    this.rejected.add(commandKey(command));
    // Movimento recusado: algo que o bot não vê (inimigo oculto) bloqueia — evita o destino por alguns turnos.
    if (command.type === 'MOVE') this.blockedMoves.set(coordKey(command.to), this.ownTurns + 4);
  }

  /** Próximo comando do personagem da vez (`view` = visão da equipe do bot). */
  decide(view: GameState): BotDecision {
    const unitId = view.turn.activeUnitId;
    const me = unitId ? view.units[unitId] : undefined;
    if (!me || me.team !== this.team || view.status !== 'active') throw new Error('Não é a vez do bot');
    const endTurn: GameplayCommand = { type: 'END_TURN', actorId: me.id, expectedTurnId: view.turn.turnId };
    const turnKey = `${view.turn.turnId}`;
    if (turnKey !== this.turnKey) {
      this.turnKey = turnKey;
      this.commandsThisTurn = 0;
      this.rejected.clear();
      this.ownTurns++;
      for (const [k, until] of this.blockedMoves) if (until <= this.ownTurns) this.blockedMoves.delete(k);
    }
    this.remember(view);
    const ctx = this.context(view, me);
    const cfg = DIFFICULTY[this.difficulty];
    const base = evaluate(view, ctx);
    const finish = (d: Omit<BotDecision, 'considered'>, considered: ScoredOption[]): BotDecision => {
      if (d.command.type !== 'END_TURN') this.commandsThisTurn++;
      return { ...d, considered };
    };
    if (this.commandsThisTurn >= MAX_COMMANDS_PER_TURN) return finish({ command: endTurn, label: 'Encerrar turno (limite)', score: base }, []);

    const scored = this.scoreCandidates(view, ctx, me, cfg.expected);
    const considered: ScoredOption[] = [{ label: 'Encerrar turno', command: endTurn, score: base }, ...scored].sort((a, b) => b.score - a.score);
    if (scored.length === 0) return finish({ command: endTurn, label: 'Encerrar turno', score: base }, considered);

    if (this.difficulty === 'easy') {
      if (this.commandsThisTurn > 0 && this.rand() < cfg.earlyEnd) return finish({ command: endTurn, label: 'Encerrar turno (cedo)', score: base }, considered);
      if (this.rand() < cfg.randomPick) {
        const pick = scored[Math.floor(this.rand() * scored.length)]!;
        return finish({ command: pick.command, label: `${pick.label} (ao acaso)`, score: pick.score }, considered);
      }
    }

    if (cfg.beam > 0) {
      const plan = this.planSequence(view, ctx, me, scored, base);
      if (plan) return finish(plan, considered);
    }
    const best = considered[0]!;
    if (best.command.type === 'END_TURN' || best.score <= base + 0.5) return finish({ command: endTurn, label: 'Encerrar turno', score: base }, considered);
    return finish({ command: best.command, label: best.label, score: best.score }, considered);
  }

  // -------------------------------------------------------------------------

  private remember(view: GameState) {
    for (const u of Object.values(view.units)) {
      if (u.team !== this.team && !u.flags.isDummy) {
        if (u.alive) this.lastSeen.set(u.id, { ...u.pos });
        else this.lastSeen.delete(u.id);
      }
    }
    // Chegou onde o inimigo foi visto e ele não está lá: esquece.
    const mine = Object.values(view.units).filter((u) => u.team === this.team && u.alive);
    for (const [id, pos] of this.lastSeen) {
      if (!view.units[id] && mine.some((u) => distance(u.pos, pos) <= 1)) this.lastSeen.delete(id);
    }
  }

  /** Exploração: vai aos pontos de início do adversário; visitados, varre uma malha do mapa (e recomeça). */
  private nextWaypoints(view: GameState, me: Unit): Coord[] {
    const fresh = () => {
      const grid: Coord[] = [];
      for (let y = 2; y < view.map.height; y += 5) for (let x = 2; x < view.map.width; x += 5) if (getCell(view.map, { x, y, floor: 0 })?.terrain === 'ground') grid.push({ x, y, floor: 0 });
      return grid;
    };
    if (!this.waypoints) this.waypoints = [...(this.options.explore ?? [])];
    const mine = Object.values(view.units).filter((u) => u.team === this.team && u.alive);
    this.waypoints = this.waypoints.filter((w) => !mine.some((u) => distance(u.pos, w) <= 2));
    if (this.waypoints.length === 0) this.waypoints = fresh().filter((w) => distance(me.pos, w) > 2);
    const spawns = (this.options.explore ?? []).filter((e) => this.waypoints!.some((w) => coordKey(w) === coordKey(e)));
    return spawns.length ? spawns : this.waypoints;
  }

  private context(view: GameState, me: Unit): EvalContext {
    const enemyFields = new Map<string, Field>();
    for (const u of Object.values(view.units)) if (u.alive && u.team !== this.team && !u.flags.isDummy) enemyFields.set(u.id, travelField(view, this.catalog, [u.pos]));
    let exploreField: Field | null = null;
    if (enemyFields.size === 0) {
      const hidden = [...this.lastSeen.entries()].filter(([id]) => !view.units[id]).map(([, p]) => p);
      const targets = hidden.length ? hidden : this.nextWaypoints(view, me);
      if (targets.length) exploreField = travelField(view, this.catalog, targets);
    }
    return { catalog: this.catalog, team: this.team, unitId: me.id, enemyFields, exploreField, reach: unitReach(me, this.catalog) };
  }

  /** Da célula `at`, alguma arma/habilidade de dano alcança um inimigo visível (alcance, andar, linha de visão)? */
  private canStrikeFrom(view: GameState, me: Unit, at: Coord, enemies: Unit[]): boolean {
    const rules: Array<{ range?: number; minRange?: number; sameFloor?: boolean; requiresLineOfSight?: boolean }> = [];
    for (const id of me.weapons) {
      const w = this.catalog.items[id];
      if (w?.kind === 'weapon') rules.push(w.target);
    }
    for (const id of me.abilities) {
      const ab = this.catalog.abilities[id];
      if (ab && ab.target.kind !== 'self' && ab.effects.some((e) => e.op === 'damage') && (ab.cost.focus ?? 0) <= me.focus) rules.push(ab.target);
    }
    return enemies.some((e) =>
      rules.some((r) => {
        const d = distance(at, e.pos);
        if (d > (r.range ?? 1) || d < (r.minRange ?? 0)) return false;
        if (r.sameFloor && at.floor !== e.pos.floor) return false;
        return !r.requiresLineOfSight || hasLineOfSight(view, this.catalog, at, e.pos);
      }),
    );
  }

  /** Simula no core com dados em "média fixa" (d20 forçado quando `forcedD20`). */
  private simulate(view: GameState, command: GameplayCommand, forcedD20?: number): GameState | null {
    const s: GameState = { ...view, rng: { mode: 'average', seed: view.rng.seed, draws: view.rng.draws, forced: forcedD20 === undefined ? [] : [forcedD20] } };
    const r = applyCommand(s, this.catalog, command);
    return r.ok ? r.state : null;
  }

  /** Valor da ação (esperado, quando há jogada de ataque) ou null se o core recusa. */
  private value(view: GameState, ctx: EvalContext, cand: Candidate, expected: boolean): { score: number; state: GameState } | null {
    if (cand.roll && expected) {
      const hit = this.simulate(view, cand.command, 19);
      if (!hit) return null;
      const miss = this.simulate(view, cand.command, 1);
      const p = cand.roll.p;
      const score = p * evaluate(hit, ctx) + (1 - p) * (miss ? evaluate(miss, ctx) : evaluate(hit, ctx));
      return { score: score + (cand.bonus ?? 0), state: p >= 0.5 ? hit : (miss ?? hit) };
    }
    const after = this.simulate(view, cand.command);
    if (!after) return null;
    return { score: evaluate(after, ctx) + (cand.bonus ?? 0), state: after };
  }

  private scoreCandidates(view: GameState, ctx: EvalContext, me: Unit, expected: boolean): Array<ScoredOption & { state: GameState }> {
    const out: Array<ScoredOption & { state: GameState }> = [];
    for (const cand of this.candidates(view, ctx, me)) {
      if (this.rejected.has(commandKey(cand.command))) continue;
      const v = this.value(view, ctx, cand, expected);
      if (v) out.push({ label: cand.label, command: cand.command, score: v.score, state: v.state, ...(cand.setup ? { setup: true } : {}) });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Ações candidatas: alvos interessantes (inimigos, áreas ao redor, objetos), ações em si, interações vizinhas e alguns movimentos. */
  private candidates(view: GameState, ctx: EvalContext, me: Unit): Candidate[] {
    const cat = this.catalog;
    const turnId = view.turn.turnId;
    const out: Candidate[] = [];
    const enemies = Object.values(view.units).filter((u) => u.alive && u.team !== this.team && !u.flags.isDummy);
    const cells = new Map<string, Coord>();
    const addCell = (c: Coord) => {
      const cell = getCell(view.map, c);
      if (cell?.terrain === 'ground') cells.set(coordKey(c), c);
    };
    for (const e of enemies) for (const c of crossArea(e.pos)) addCell(c);
    for (const o of Object.values(view.objects)) {
      if (o.state === 'destroyed') continue;
      const def = cat.objects[o.defId];
      // Barris (explosão perto de inimigos), caixas/portas no caminho.
      if (def?.explosion ? enemies.some((e) => distance(e.pos, o.pos) <= 3) : def?.hp != null && distance(o.pos, me.pos) <= 2) addCell(o.pos);
    }
    const targets = [...cells.values()];
    const inRange = (rule: { range?: number; minRange?: number }, c: Coord) => {
      const d = distance(me.pos, c);
      return d <= (rule.range ?? 1) && d >= (rule.minRange ?? 0);
    };
    const rollFor = (c: Coord): Candidate['roll'] => {
      const victim = unitAt(view, c);
      return victim && victim.team !== this.team ? { p: attackHitChance(me.attackBonus, victim.defense) } : undefined;
    };
    if (me.ap > 0) {
      for (const id of me.weapons) {
        const w = cat.items[id];
        if (w?.kind !== 'weapon') continue;
        for (const c of targets) {
          if (!inRange(w.target, c)) continue;
          const roll = rollFor(c);
          out.push({ label: `${w.name} em ${coordKey(c)}`, command: { type: 'BASIC_ATTACK', actorId: me.id, weaponId: w.id, target: cellTarget(c), expectedTurnId: turnId }, ...(roll ? { roll } : {}) });
        }
      }
      for (const id of me.abilities) {
        const ab = cat.abilities[id];
        if (!ab) continue;
        if (ab.target.kind === 'self') {
          out.push({ label: ab.name, command: { type: 'USE_ABILITY', actorId: me.id, abilityId: ab.id, target: { kind: 'self' }, expectedTurnId: turnId } });
          continue;
        }
        for (const c of targets) {
          if (!inRange(ab.target, c)) continue;
          const roll = ab.attackRoll ? rollFor(c) : undefined;
          out.push({ label: `${ab.name} em ${coordKey(c)}`, command: { type: 'USE_ABILITY', actorId: me.id, abilityId: ab.id, target: cellTarget(c), expectedTurnId: turnId }, ...(roll ? { roll } : {}) });
        }
      }
      for (const id of me.consumables) {
        const item = cat.items[id];
        if (item?.kind !== 'consumable') continue;
        if (item.target.kind === 'self') {
          out.push({ label: item.name, command: { type: 'USE_ITEM', actorId: me.id, itemId: item.id, target: { kind: 'self' }, expectedTurnId: turnId } });
          continue;
        }
        for (const c of targets) if (inRange(item.target, c)) out.push({ label: `${item.name} em ${coordKey(c)}`, command: { type: 'USE_ITEM', actorId: me.id, itemId: item.id, target: cellTarget(c), expectedTurnId: turnId } });
      }
      if (!me.defendedThisTurn) out.push({ label: 'Defender', command: { type: 'DEFEND', actorId: me.id, expectedTurnId: turnId } });
      // Interações com objetos vizinhos (porta, baú, altar, cisterna, alavanca).
      for (const o of Object.values(view.objects)) {
        const def = cat.objects[o.defId];
        if (!def?.interaction || o.state === 'destroyed' || distance(o.pos, me.pos) > 1) continue;
        let bonus = 0;
        if (o.defId === 'door' && o.state === 'closed') {
          // Abrir a porta que está no caminho do inimigo / da exploração.
          const field = enemies.length ? ctx.enemyFields.get(enemies[0]!.id) : ctx.exploreField;
          const here = field?.get(coordKey(me.pos));
          const door = field?.get(coordKey(o.pos));
          if (here !== undefined && door !== undefined && door < here) bonus = 8;
        }
        if (o.defId === 'door' && o.state === 'open') bonus = -3;
        if (o.defId === 'lever') bonus = -1;
        out.push({ label: `Interagir: ${def.name}`, command: { type: 'INTERACT', actorId: me.id, objectId: o.id, expectedTurnId: turnId }, bonus });
      }
    }
    // Movimentos: melhores células pela posição + algumas ao acaso (fácil).
    if (me.mp > 0 && !me.statuses.some((s) => s.statusId === 'rooted')) {
      const cfg = DIFFICULTY[this.difficulty];
      const reach = [...reachableCells(view, this.catalog, me.pos, me.mp).values()].filter((r) => r.cost > 0);
      const surfacePenalty = (c: Coord) => WEIGHTS.surfaceOwn[getCell(view.map, c)?.surface?.kind ?? ''] ?? 0;
      const ranked = reach.map((r) => ({ r, s: positionScore(view, ctx, me, r.coord) + surfacePenalty(r.coord) - r.cost * WEIGHTS.mp })).sort((a, b) => b.s - a.s);
      const chosen = ranked.slice(0, cfg.moves);
      for (let i = 0; i < cfg.randomMoves && ranked.length > chosen.length; i++) {
        const pick = ranked[Math.floor(this.rand() * ranked.length)]!;
        if (!chosen.includes(pick)) chosen.push(pick);
      }
      // Normal/difícil: também as células de onde dá para atacar um inimigo visível (as mais baratas).
      const attackSpots = cfg.expected && me.ap > 0 ? ranked.filter(({ r }) => this.canStrikeFrom(view, me, r.coord, enemies)).sort((a, b) => a.r.cost - b.r.cost).slice(0, 4) : [];
      for (const x of attackSpots) if (!chosen.includes(x)) chosen.push(x);
      for (const x of chosen) if (!this.blockedMoves.has(coordKey(x.r.coord))) out.push({ label: `Mover para ${coordKey(x.r.coord)}`, command: { type: 'MOVE', actorId: me.id, to: x.r.coord, expectedTurnId: turnId }, ...(attackSpots.includes(x) ? { setup: true } : {}) });
    }
    return out;
  }

  /**
   * Bot difícil: para as melhores ações, completa o turno de forma gulosa (até `depth` ações a
   * mais) e avalia o estado final menos a ameaça do adversário no turno dele. Devolve a
   * primeira ação da melhor sequência (o turno é replanejado a cada comando, com o resultado
   * real dos dados).
   */
  private planSequence(view: GameState, ctx: EvalContext, me: Unit, scored: Array<ScoredOption & { state: GameState }>, base: number): Omit<BotDecision, 'considered'> | null {
    const cfg = DIFFICULTY.hard;
    const leaf = (s: GameState) => {
      const ctxS = { ...ctx, unitId: me.id };
      const v = evaluate(s, ctxS);
      if (s.status === 'finished') return v;
      return v - (cfg.threat ? WEIGHTS.threat * WEIGHTS.ownHp * threatAgainst(s, this.catalog, this.team) : 0);
    };
    let best: { score: number; first: ScoredOption } | null = null;
    const endValue = leaf(view);
    const roots = scored.slice(0, cfg.beam);
    for (const x of scored) if (x.setup && !roots.includes(x) && roots.length < cfg.beam + 3) roots.push(x);
    for (const root of roots) {
      let state = root.state;
      for (let d = 0; d < cfg.depth; d++) {
        const unit = state.units[me.id];
        if (state.status !== 'active' || state.turn.activeUnitId !== me.id || !unit?.alive) break;
        const next = this.scoreCandidates(state, ctx, unit, true)[0];
        if (!next || next.score <= evaluate(state, ctx) + 0.5) break;
        state = next.state;
      }
      const score = leaf(state);
      if (!best || score > best.score) best = { score, first: root };
    }
    if (!best || best.score <= endValue + 0.5 || best.first.score <= base - 25) return { command: { type: 'END_TURN', actorId: me.id, expectedTurnId: view.turn.turnId }, label: 'Encerrar turno', score: endValue };
    return { command: best.first.command, label: `${best.first.label} (plano)`, score: best.score };
  }
}
