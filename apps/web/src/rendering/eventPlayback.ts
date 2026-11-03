/**
 * Reprodução visual dos eventos de um comando aceito (seção 9: a apresentação só mostra
 * o que o core decidiu). Nada aqui calcula regra: todo número exibido vem de um evento.
 *
 * - `UNIT_MOVED` / `FORCED_MOVE`: o personagem anda célula a célula, na ordem dos eventos,
 *   com um pulinho (os modelos são estáticos) e virando para a direção do passo; escadas
 *   fazem um arco. A câmera acompanha (CameraEventQueue, interrompível).
 * - `ATTACK_PERFORMED` / `ABILITY_USED` / `ITEM_USED`: a câmera foca o alvo; no fim, volta
 *   ao executor.
 * - `ATTACK_ROLLED`: selo do d20 sobre o alvo ("17 + 5 = 22 vs Def 14 — ACERTO / ERRO /
 *   CRÍTICO!"); no erro, "ERROU" flutuante.
 * - `DICE_ROLLED`: fórmula e dados ("2d6+10: [3,5]+10 = 18").
 * - `DAMAGE_APPLIED` (vermelho), `HEALED` (verde), barreira absorvida/concedida (azul),
 *   `OBJECT_DAMAGED` / `OBJECT_DESTROYED` nos objetos, `STATUS_APPLIED` (nome do estado).
 *   As barras sobre os personagens acompanham os eventos (`UnitStatusBars.patch`).
 * - `INITIATIVE_ROLLED`: repassado à tela (painel de iniciativa).
 * - Efeitos visuais e animações dos personagens: `arena.vfx.event(ev)` para cada evento
 *   (vfx.ts). Ordem de uma ação: animação do executor → projétil → d20 → impacto/número →
 *   reações (explosão, superfícies). Ataque típico ≈ 1,5–2 s; "rápido" (tecla T) divide por 2
 *   todas as durações e pausas (`anim.pace`).
 * Ao terminar, quem chamou sincroniza a cena com o estado final (`ArenaView.sync`).
 */
import { Vector3 } from '@babylonjs/core';
import { sameCoord, type Catalog, type Coord, type GameEvent, type GameState } from '@bardurinho/domain';
import { tween, wait } from './anim.js';
import type { ArenaView } from './ArenaView.js';
import type { CameraEventQueue } from './camera/CameraEventQueue.js';
import { standingPoint } from './terrain.js';
import type { UnitStatusBars } from './unitBars.js';
import type { WorldLabels } from './worldLabels.js';

/** Duração de um passo (s). */
export const STEP_SECONDS = 0.25;
/** Duração de um passo de escada (s). */
const STAIR_STEP_SECONDS = 0.5;
const HOP_HEIGHT = 0.18;
const STAIR_ARC = 0.7;
/** Pausas de leitura (s): selo do d20, fórmula dos dados, número de dano. */
const ROLL_PAUSE = 0.5;
const DICE_PAUSE = 0.3;
const NUMBER_PAUSE = 0.2;

/** Compatibilidade: tween no ritmo da reprodução (ver anim.ts). */
export { tween } from './anim.js';

export interface InitiativeRoll {
  unitId: string;
  roll: number;
}

export interface PlaybackContext {
  scene: import('@babylonjs/core').Scene;
  arena: ArenaView;
  labels: WorldLabels;
  catalog?: Catalog;
  bars?: UnitStatusBars;
  camera?: CameraEventQueue;
  /** Estado depois do comando (nomes e posições de objetos). */
  after?: GameState;
  /** Iniciativa rolada no início da partida. */
  onInitiative?: (rolls: InitiativeRoll[], order: string[]) => void;
}

async function playStep(ctx: PlaybackContext, unitId: string, from: Coord, to: Coord): Promise<void> {
  const view = ctx.arena.unitView(unitId);
  if (!view) return;
  const map = ctx.arena.map;
  const a = standingPoint(map, from);
  const b = standingPoint(map, to);
  const stairs = from.floor !== to.floor;
  view.face(b.x - a.x, b.z - a.z);
  ctx.camera?.enqueue({ eventType: 'UNIT_MOVED', priority: 1, targetEntity: unitId, targetCell: to, durationHint: STEP_SECONDS, interruptible: true });
  let floorSwapped = false;
  await tween(ctx.scene, stairs ? STAIR_STEP_SECONDS : STEP_SECONDS, (t) => {
    // Suaviza o passo (ease in-out) e soma o pulinho/arco.
    const e = t * t * (3 - 2 * t);
    const lift = Math.sin(Math.PI * t) * (stairs ? STAIR_ARC : HOP_HEIGHT);
    view.setVisualPosition(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e + lift, a.z + (b.z - a.z) * e);
    // Troca o andar visual no meio do passo (fantasma/seleção acompanham o personagem).
    if (stairs && !floorSwapped && t >= 0.5) {
      floorSwapped = true;
      ctx.arena.floorView.move(view.root, to.floor);
    }
  });
}

/** Ponto acima de uma entidade (personagem: cabeça; objeto: topo aproximado). */
function anchor(ctx: PlaybackContext, id: string | null | undefined, lift = 0): Vector3 | null {
  if (!id) return null;
  const unit = ctx.arena.unitView(id);
  if (unit) {
    const h = unit.headPosition();
    return new Vector3(h.x, h.y + lift, h.z);
  }
  const obj = ctx.arena.objectView(id);
  if (obj) {
    const p = obj.root.position;
    return new Vector3(p.x, p.y + 1.5 + lift, p.z);
  }
  return null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '');

/** "2d6+10: [3,5]+10 = 18" (crítico: dados em dobro). */
function diceText(p: Record<string, unknown>): string {
  const rolls = (p.rolls as Array<{ value: number }>).map((r) => r.value).join(',');
  const bonus = Number(p.bonus);
  return `${p.critical ? 'crítico · ' : ''}${p.formula}: [${rolls}]${signed(bonus)} = ${p.total}`;
}

const PURPOSE_CLASS: Record<string, string> = { damage: 'dice-damage', heal: 'dice-heal' };

/** Toca os eventos em ordem; resolve quando a animação termina. */
export async function playEvents(ctx: PlaybackContext, events: readonly GameEvent[]): Promise<void> {
  ctx.camera?.begin();
  ctx.arena.vfx.begin();
  let moved = false;
  /** Executor de um ataque/habilidade cuja câmera foi para o alvo: volta a ele no fim. */
  let returnTo: string | null = null;
  for (const ev of events) {
    const p = ev.payload;
    switch (ev.type) {
      case 'UNIT_MOVED':
      case 'FORCED_MOVE': {
        const m = p as { unitId: string; from: Coord; to: Coord };
        await playStep(ctx, m.unitId, m.from, m.to);
        moved = true;
        break;
      }
      case 'ATTACK_PERFORMED':
      case 'ABILITY_USED':
      case 'ITEM_USED': {
        const actorId = String(p.actorId);
        const target = p.target as Coord | undefined;
        const actor = ctx.after?.units[actorId];
        if (target && actor && !sameCoord(target, actor.pos)) {
          // Alvo perto (≤ 8 células): enquadra o ponto médio, para ver o executor, o projétil
          // e o impacto; longe: foca o alvo.
          const near = Math.max(Math.abs(target.x - actor.pos.x), Math.abs(target.y - actor.pos.y)) <= 8;
          const cell = near ? { x: Math.round((target.x + actor.pos.x) / 2), y: Math.round((target.y + actor.pos.y) / 2), floor: target.floor } : target;
          ctx.camera?.enqueue({ eventType: ev.type, priority: 1, targetCell: cell, durationHint: 1, interruptible: true });
          returnTo = actorId;
        }
        break;
      }
      case 'ATTACK_ROLLED': {
        const r = p as { targetId: string; natural: number; bonus: number; total: number; defense: number; hit: boolean; critical: boolean };
        const at = anchor(ctx, r.targetId, 1.25);
        if (at) {
          const verdict = r.critical ? 'CRÍTICO!' : r.hit ? 'ACERTO' : r.natural === 1 ? 'ERRO (1 natural)' : 'ERRO';
          const cls = r.critical ? 'crit' : r.hit ? 'hit' : 'miss';
          const nat = r.natural === 20 || r.natural === 1 ? ' nat' : '';
          ctx.labels.float(
            `<span class="d20${nat}" title="d20">${r.natural}</span> ${r.bonus < 0 ? `− ${-r.bonus}` : `+ ${r.bonus}`} = ${r.total} vs Def ${r.defense} — <b>${verdict}</b>`,
            at, `roll ${cls}`, 1900, true,
          );
          if (!r.hit) {
            const head = anchor(ctx, r.targetId, -0.35);
            if (head) ctx.labels.float('ERROU', head, 'miss', 1700);
          }
        }
        await wait(ctx.scene, ROLL_PAUSE);
        break;
      }
      case 'DICE_ROLLED': {
        const purpose = String(p.purpose);
        const at = anchor(ctx, (p.targetId as string | null) ?? String(ev.cause.sourceId ?? ''), 0.7);
        if (at) ctx.labels.float(diceText(p), at, `dice ${PURPOSE_CLASS[purpose] ?? 'dice-other'}`, 1500);
        await wait(ctx.scene, DICE_PAUSE);
        break;
      }
      case 'DAMAGE_APPLIED': {
        const id = String(p.targetId);
        const hp = Number(p.hpDamage ?? 0);
        const shield = Number(p.shieldAbsorbed ?? 0);
        const head = anchor(ctx, id, -0.35);
        if (head) {
          if (hp > 0) ctx.labels.float(`−${hp}`, head, 'damage', 1700);
          if (shield > 0) ctx.labels.float(`−${shield} barreira`, head.add(new Vector3(0, -0.45, 0)), 'damage-blocked');
          if (hp === 0 && shield === 0) ctx.labels.float('0', head, 'damage-blocked');
        }
        ctx.bars?.patch(id, { hp: Number(p.hpAfter), shield: Number(p.shieldAfter ?? 0) });
        if (p.defeated) ctx.camera?.enqueue({ eventType: ev.type, priority: 2, targetEntity: id, durationHint: 1, interruptible: true });
        // Pequena pausa para o número ser lido antes do próximo passo/evento.
        await wait(ctx.scene, moved ? NUMBER_PAUSE : NUMBER_PAUSE / 2);
        break;
      }
      case 'UNIT_DEFEATED': {
        const id = String(p.unitId);
        const head = anchor(ctx, id, 0.5);
        if (head) ctx.labels.float('DERROTADO', head, 'defeated', 2200);
        ctx.bars?.patch(id, { defeated: true });
        break;
      }
      case 'OBJECT_DAMAGED': {
        const at = anchor(ctx, String(p.objectId));
        if (at) ctx.labels.float(`−${Number(p.raw)}`, at, 'damage', 1700);
        await wait(ctx.scene, NUMBER_PAUSE / 2);
        break;
      }
      case 'OBJECT_DESTROYED': {
        const at = anchor(ctx, String(p.objectId), 0.5);
        const name = ctx.catalog?.objects[String(p.defId)]?.name ?? 'objeto';
        if (at) ctx.labels.float(`${name} destruído`, at, 'destroyed', 1800);
        break;
      }
      case 'EXPLOSION':
        ctx.camera?.enqueue({ eventType: ev.type, priority: 2, targetCell: p.center as Coord, durationHint: 1, interruptible: true });
        break;
      case 'HEALED': {
        const id = String(p.unitId);
        const head = anchor(ctx, id, -0.35);
        if (head) ctx.labels.float(`+${Number(p.effective)}`, head, 'heal', 1700);
        ctx.bars?.patch(id, { hp: Number(p.hpAfter) });
        break;
      }
      case 'SHIELD_GRANTED': {
        const id = String(p.unitId);
        const head = anchor(ctx, id, -0.35);
        if (head) ctx.labels.float(p.applied ? `+${Number(p.granted)} barreira` : 'barreira mantida', head, 'shield');
        if (p.applied) ctx.bars?.patch(id, { shield: Number(p.current) });
        break;
      }
      case 'STATUS_APPLIED':
      case 'STATUS_REFRESHED': {
        const head = anchor(ctx, String(p.unitId), -0.45);
        const name = ctx.catalog?.statuses[String(p.statusId)]?.name ?? String(p.statusId);
        if (head) ctx.labels.float(name, head, 'status', 1600);
        break;
      }
      case 'INITIATIVE_ROLLED':
        ctx.onInitiative?.(p.rolls as InitiativeRoll[], p.order as string[]);
        break;
    }
    await ctx.arena.vfx.event(ev, ctx.after);
  }
  if (returnTo) {
    // Deixa o último número ser lido e devolve a câmera ao executor (seção 14.10).
    await wait(ctx.scene, 0.35);
    const pos = ctx.after?.units[returnTo]?.pos;
    if (pos) ctx.camera?.enqueue({ eventType: 'return.control', priority: 1, targetEntity: returnTo, targetCell: pos, durationHint: 0.5, interruptible: true });
  }
}
