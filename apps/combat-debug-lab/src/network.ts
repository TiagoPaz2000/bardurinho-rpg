/**
 * Combat Debug Lab — modo NETWORK (Fase 3, seção 15 "NETWORK"): compara
 *
 *   SERVER STATE  ×  CLIENT A VIEW  ×  CLIENT B VIEW
 *
 * de uma partida do servidor de jogo, pelas rotas de desenvolvimento `/debug/*` (só existem
 * com o servidor em modo dev). Para cada equipe mostra o que o servidor enviou (projeção),
 * a confirmação do cliente (`ack` com o hash do estado que ele tem), divergências, unidades
 * escondidas daquela equipe e uma checagem local de vazamento: a projeção é recalculada aqui
 * a partir do estado oficial e precisa bater com a do servidor e só conter o que a equipe vê.
 * Células fora da visão da equipe ficam escurecidas.
 *
 * Abrir: http://127.0.0.1:5174/network.html (servidor: `npm run server`).
 */
import { catalog } from '@bardurinho/content';
import { computeTeamVision, coordKey, projectStateForClient, type GameState } from '@bardurinho/domain';
import { DEFAULT_SERVER_PORT, stateHash } from '@bardurinho/protocol';
import { h } from './dom.js';
import { CELL, render, type Layers } from './render.js';

interface SeatDebug {
  seat: number;
  team: string;
  username: string | null;
  connected: boolean;
  projection: { state: GameState; hash: string; hiddenUnits: string[] };
  sent: { version: number; hash: string } | null;
  ack: { version: number; hash: string } | null;
  inSync: boolean;
  divergences: Array<{ version: number; expected: string; got: string }>;
  historyEvents: number;
}

interface MatchDebug {
  matchId: string;
  roomId?: string;
  live: boolean;
  version: number;
  seed?: number;
  turnSeconds?: number;
  timer?: { deadline: number; serverNow: number } | null;
  official: GameState;
  officialHash: string;
  seats: SeatDebug[];
  commands: Array<{ seq: number; commandId: string; authorKind: string; seat: number | null; turnId: number; payload: { type?: string; actorId?: string }; accepted: boolean; error: { code?: string } | null; versionAfter: number | null }>;
}

interface MatchList {
  live: Array<{ matchId: string; roomId: string; status: string; version: number; round: number; seats: Array<{ team: string; username: string | null; connected: boolean }> }>;
  recent: Array<{ matchId: string; status: string; result: unknown }>;
}

const params = new URLSearchParams(location.search);
const server = params.get('server') ?? `http://${location.hostname || '127.0.0.1'}:${DEFAULT_SERVER_PORT}`;
const root = document.getElementById('net')!;
const LAYERS: Layers = { terrain: true, surface: true, objects: true, units: true, coordinates: false, movementCost: false, reachable: false, lineOfSight: false, attackRange: false };

let selected: string | null = params.get('match');
let floor = 0;
let paused = false;
let error = '';
let list: MatchList | null = null;
let detail: MatchDebug | null = null;

async function poll() {
  if (paused) return;
  try {
    list = (await (await fetch(`${server}/debug/matches`)).json()) as MatchList;
    if (!selected && list.live[0]) selected = list.live[0].matchId;
    detail = selected ? ((await (await fetch(`${server}/debug/matches/${selected}`)).json()) as MatchDebug) : null;
    error = '';
  } catch (err) {
    error = `Sem resposta de ${server}/debug — o servidor está rodando em modo dev (npm run server)? ${String(err)}`;
  }
  draw();
}

/** Desenha o mapa e escurece as células fora da visão da equipe (no estado oficial). */
function mapCanvas(state: GameState, team: string | null): HTMLCanvasElement {
  const canvas = h('canvas');
  const ctx = canvas.getContext('2d')!;
  render(ctx, { state, catalog, floor, layers: LAYERS, selectedCell: null, selectedUnitId: null, hoverCell: null, rangePreview: null });
  if (team && detail) {
    const vision = computeTeamVision(detail.official, catalog, team);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    for (let y = 0; y < state.map.height; y++)
      for (let x = 0; x < state.map.width; x++) if (!vision.visibleCells.has(coordKey({ x, y, floor }))) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  return canvas;
}

const yes = (ok: boolean, good: string, bad: string) => h('span', { class: ok ? 'ok' : 'bad' }, ok ? good : bad);

function seatColumn(d: MatchDebug, s: SeatDebug): HTMLElement {
  // Checagem local: projeção recalculada do oficial = projeção do servidor; só unidades vistas (ou derrotadas).
  const local = projectStateForClient(d.official, catalog, s.team);
  const localHash = stateHash(local.state);
  const visible = local.vision.visibleUnits;
  const extra = d.official.status === 'finished' ? [] : Object.values(s.projection.state.units).filter((u) => u.alive && !visible.has(u.id));
  const seedHidden = s.projection.state.rng.seed === 0;
  return h('div', { class: 'net-col' },
    h('h3', {}, h('span', {}, `CLIENT ${s.team} VIEW`), h('span', { class: s.connected ? 'ok' : 'warn' }, `${s.username ?? 'livre'} · ${s.connected ? 'online' : 'offline'}`)),
    mapCanvas(s.projection.state, s.team),
    h('div', { class: 'net-kv' },
      h('span', {}, 'Enviado'), h('span', {}, s.sent ? `v${s.sent.version} · ${s.sent.hash}` : '—'),
      h('span', {}, 'Ack do cliente'), h('span', {}, s.ack ? `v${s.ack.version} · ${s.ack.hash}` : '—'),
      h('span', {}, 'Sincronia'), yes(s.inSync, 'cliente = servidor (hash confere)', s.ack ? 'cliente atrasado ou divergente' : 'sem ack'),
      h('span', {}, 'Divergências'), yes(s.divergences.length === 0, '0', `${s.divergences.length} (última v${s.divergences.at(-1)?.version})`),
      h('span', {}, 'Ocultos p/ equipe'), h('span', {}, s.projection.hiddenUnits.length ? s.projection.hiddenUnits.join(', ') + ' (não enviados)' : '—'),
      h('span', {}, 'Vazamento'), yes(extra.length === 0 && seedHidden, 'nenhum (só unidades vistas, semente zerada)', `VAZOU: ${extra.map((u) => u.id).join(', ')}${seedHidden ? '' : ' + semente'}`),
      h('span', {}, 'Projeção local'), yes(localHash === s.projection.hash, `confere (${localHash})`, `≠ servidor (${localHash})`),
      h('span', {}, 'Eventos enviados'), h('span', {}, String(s.historyEvents)),
    ));
}

function draw() {
  const live = list?.live ?? [];
  const recent = list?.recent ?? [];
  const bar = h('div', { class: 'net-bar' },
    h('strong', {}, 'COMBAT DEBUG LAB · NETWORK'),
    h('a', { href: '/', class: 'btn' }, '← Lab'),
    h('span', { class: 'pill' }, `servidor ${server}`),
    h('button', { class: paused ? 'on' : '', onclick: () => { paused = !paused; draw(); } }, paused ? 'Retomar' : 'Pausar'),
    h('span', { class: 'group' }, 'Andar:', ...[0, 1].map((f) => h('button', { class: floor === f ? 'on' : '', onclick: () => { floor = f; draw(); } }, String(f)))),
    h('span', { class: 'net-list' },
      ...live.map((m) => h('button', { class: m.matchId === selected ? 'on' : '', onclick: () => { selected = m.matchId; void poll(); } },
        `${m.roomId} · ${m.status} · v${m.version} · ${m.seats.map((s) => `${s.team}:${s.username ?? '—'}${s.connected ? '' : '(off)'}`).join(' ')}`)),
      ...recent.slice(0, 5).map((m) => h('button', { class: m.matchId === selected ? 'on' : '', title: JSON.stringify(m.result), onclick: () => { selected = m.matchId; void poll(); } }, `${m.matchId.slice(0, 8)} · ${m.status} (banco)`)),
    ),
  );
  const body: Array<HTMLElement> = [];
  if (error) body.push(h('div', { class: 'net-empty bad' }, error));
  else if (!detail) body.push(h('div', { class: 'net-empty' }, 'Nenhuma partida em andamento. Abra dois clientes em http://127.0.0.1:5173/?mode=rede.'));
  else {
    const d = detail;
    const o = d.official;
    const timer = d.timer ? Math.max(0, Math.ceil((d.timer.deadline - d.timer.serverNow) / 1000)) : null;
    const serverCol = h('div', { class: 'net-col' },
      h('h3', {}, h('span', {}, 'SERVER STATE (oficial)'), h('span', {}, d.live ? 'em memória' : 'banco (encerrada)')),
      mapCanvas(o, null),
      h('div', { class: 'net-kv' },
        h('span', {}, 'Partida'), h('span', {}, d.matchId),
        h('span', {}, 'Versão'), h('span', {}, `v${d.version} · ${d.officialHash}`),
        h('span', {}, 'Estado'), h('span', {}, `${o.status} · rodada ${o.turn.round} · turno #${o.turn.turnId} · vez de ${o.turn.activeUnitId ?? '—'}`),
        h('span', {}, 'Resultado'), h('span', {}, o.result ? JSON.stringify(o.result) : '—'),
        h('span', {}, 'Semente'), h('span', {}, d.seed !== undefined ? `${d.seed} (só no servidor)` : '—'),
        h('span', {}, 'Cronômetro'), h('span', {}, timer !== null ? `${timer} s de ${d.turnSeconds} s` : '—'),
        h('span', {}, 'Unidades'), h('span', {}, Object.values(o.units).map((u) => `${u.id}@${u.pos.x},${u.pos.y},${u.pos.floor} ${u.hp}PV`).join(' · ')),
      ));
    body.push(h('div', { class: 'net-cols' }, serverCol, ...d.seats.map((s) => seatColumn(d, s))));
    body.push(h('table', { class: 'net-table' },
      h('tr', {}, ...['#', 'commandId', 'autor', 'turno', 'comando', 'resultado', 'versão'].map((t) => h('th', {}, t))),
      ...[...d.commands].reverse().slice(0, 25).map((c) => h('tr', {},
        h('td', {}, String(c.seq)),
        h('td', {}, h('code', {}, c.commandId.length > 24 ? `${c.commandId.slice(0, 24)}…` : c.commandId)),
        h('td', {}, c.authorKind === 'player' ? `assento ${c.seat}` : c.authorKind),
        h('td', {}, String(c.turnId)),
        h('td', {}, `${c.payload?.type ?? '?'} ${c.payload?.actorId ?? ''}`),
        h('td', { class: c.accepted ? 'ok' : 'bad' }, c.accepted ? 'aceito' : `recusado: ${c.error?.code ?? '?'}`),
        h('td', {}, c.versionAfter !== null ? `v${c.versionAfter}` : '—'),
      ))));
  }
  root.replaceChildren(bar, ...body);
}

void poll();
setInterval(() => void poll(), 1000);
