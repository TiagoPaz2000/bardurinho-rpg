/**
 * @bardurinho/protocol — contrato de rede entre cliente e servidor (seção 11).
 *
 * O conteúdo do comando é o mesmo `GameplayCommand` do domínio; o envelope adiciona versão
 * do protocolo e `commandId` (UUID do cliente) para detectar repetição. O cliente nunca
 * envia dano, resultado ou estado: só intenção. Puro (sem Colyseus): usado pelo servidor
 * (apps/server), pelo cliente (apps/web), pelo Combat Debug Lab e pelos testes.
 */
import type { CommandError, CommandTarget, Coord, GameEvent, GameplayCommand, GameState } from '@bardurinho/domain';
import type { AppearanceDto, MatchRewardDto } from './api.js';

export * from './api.js';

export const PROTOCOL_VERSION = 1;
/** Endereço padrão do servidor de jogo (seção 10.1). */
export const DEFAULT_SERVER_PORT = 2567;
/** Nome da sala de partida no Colyseus. */
export const MATCH_ROOM = 'arena';

export type ClientCommand = GameplayCommand & {
  protocolVersion: number;
  /** UUID gerado pelo cliente; o servidor rejeita repetições. */
  commandId: string;
};

/** Códigos de rejeição do servidor (além dos do core, `CommandErrorCode`). */
export type ServerErrorCode =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_PROTOCOL'
  | 'COMMAND_NOT_ALLOWED'
  | 'NOT_YOUR_UNIT'
  | 'NOT_A_PLAYER'
  | 'DUPLICATE_COMMAND'
  | 'PERSISTENCE_ERROR';

export interface ServerError {
  code: ServerErrorCode | CommandError['code'];
  message: string;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

/** Mensagens cliente → servidor (tipo Colyseus → payload). */
export interface ClientMessages {
  command: ClientCommand;
  /** Confirmação: o cliente aplicou a versão e calculou este hash do estado que tem. */
  ack: { version: number; hash: string };
  /** Pede um snapshot novo (o cliente percebeu uma lacuna de versões). */
  resync: Record<string, never>;
}

export interface SeatInfo {
  seat: number;
  team: string;
  username: string | null;
  displayName: string | null;
  connected: boolean;
  /** Fase 5: personagem do assento (nome e cosméticos — públicos; a classe só aparece quando é vista). */
  character?: { name: string; appearance: AppearanceDto } | null;
  /** Fase 5: assento controlado pelo bot do servidor (dificuldade). */
  bot?: string | null;
}

export interface TurnTimer {
  turnId: number;
  /** Instante (ms desde a época, relógio do servidor) em que o turno acaba sozinho. */
  deadline: number;
  turnSeconds: number;
  /** `Date.now()` do servidor ao enviar: o cliente corrige a diferença de relógio. */
  serverNow: number;
}

/** Snapshot autorizado (entrada, reconexão, ressincronização — seção 11.5 / 14.14). */
export interface SnapshotMessage {
  matchId: string;
  roomId: string;
  /** Versão do estado oficial: +1 por comando aceito. */
  version: number;
  /** Equipe do jogador; o estado já vem projetado para ela. */
  team: string;
  seat: number;
  state: GameState;
  hash: string;
  timer: TurnTimer | null;
  seats: SeatInfo[];
  /** Eventos já filtrados desde o início (resumo da partida). */
  history: GameEvent[];
  reason: 'join' | 'reconnect' | 'resync';
}

/** Um comando aceito (de qualquer jogador ou do cronômetro), projetado para a equipe. */
export interface UpdateMessage {
  version: number;
  /** `commandId` do autor (só para quem enviou; os outros recebem `null`). */
  commandId: string | null;
  author: { seat: number | null; kind: 'player' | 'timer' | 'server' };
  commandType: string;
  events: GameEvent[];
  state: GameState;
  hash: string;
  timer: TurnTimer | null;
}

/** Resposta ao autor do comando. */
export type CommandResultMessage =
  | { commandId: string; ok: true; version: number; duplicate: boolean }
  | { commandId: string; ok: false; error: ServerError; duplicate: boolean };

export interface PresenceMessage {
  seats: SeatInfo[];
}

/** Mensagens servidor → cliente. */
export interface ServerMessages {
  snapshot: SnapshotMessage;
  update: UpdateMessage;
  result: CommandResultMessage;
  presence: PresenceMessage;
  /** Fase 5: recompensa calculada pelo servidor ao fim da partida (por conta). */
  rewards: MatchRewardDto;
}

/** Resposta de `POST /auth/login`. */
export interface LoginResponse {
  token: string;
  account: { id: string; username: string; displayName: string };
  /** Fase 5: validade da sessão (ms desde a época). */
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Validação de formato (etapa 2 da seção 11.2)
// ---------------------------------------------------------------------------

const MAX_ID = 64;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID && /^[\w.:-]+$/.test(v);
const isInt = (v: unknown, min = -1, max = 1000): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isCoord = (v: unknown): v is Coord => {
  const c = v as Record<string, unknown>;
  return typeof v === 'object' && v !== null && isInt(c.x, 0, 255) && isInt(c.y, 0, 255) && isInt(c.floor, 0, 16) && Object.keys(c).length === 3;
};
const isTarget = (v: unknown): v is CommandTarget => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  if (t.kind === 'self') return Object.keys(t).length === 1;
  if (t.kind === 'entity') return isId(t.id) && Object.keys(t).length === 2;
  if (t.kind === 'cell') return isCoord({ x: t.x, y: t.y, floor: t.floor }) && Object.keys(t).length === 4;
  return false;
};

/** Campos permitidos por tipo de comando (o resto é recusado: nada de "dano" vindo do cliente). */
const SHAPES: Record<string, Record<string, (v: unknown) => boolean>> = {
  MOVE: { actorId: isId, to: isCoord },
  BASIC_ATTACK: { actorId: isId, weaponId: isId, target: isTarget },
  USE_ABILITY: { actorId: isId, abilityId: isId, target: isTarget },
  USE_ITEM: { actorId: isId, itemId: isId, target: (v) => v === undefined || isTarget(v) },
  DEFEND: { actorId: isId },
  INTERACT: { actorId: isId, objectId: isId },
  END_TURN: { actorId: isId },
  SURRENDER: { actorId: isId },
};
const ENVELOPE = new Set(['type', 'protocolVersion', 'commandId', 'expectedTurnId']);
/** Comandos que existem no domínio mas nunca vêm de um cliente (START_MATCH é do servidor). */
const SERVER_ONLY = new Set(['START_MATCH']);

export type ParsedCommand = { ok: true; command: ClientCommand } | { ok: false; commandId: string | null; error: ServerError };

/** Valida tipo, campos e limites do envelope e do comando. */
export function parseClientCommand(value: unknown): ParsedCommand {
  const bad = (code: ServerErrorCode, message: string, commandId: string | null = null): ParsedCommand => ({ ok: false, commandId, error: { code, message } });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad('INVALID_FORMAT', 'Comando precisa ser um objeto');
  const v = value as Record<string, unknown>;
  const commandId = typeof v.commandId === 'string' && v.commandId.length > 0 && v.commandId.length <= MAX_ID ? v.commandId : null;
  if (!commandId) return bad('INVALID_FORMAT', 'commandId ausente ou inválido');
  if (v.protocolVersion !== PROTOCOL_VERSION) return bad('UNSUPPORTED_PROTOCOL', `Versão do protocolo ${String(v.protocolVersion)} ≠ ${PROTOCOL_VERSION}`, commandId);
  if (typeof v.type !== 'string') return bad('INVALID_FORMAT', 'Tipo ausente', commandId);
  if (v.type.startsWith('DEBUG_') || SERVER_ONLY.has(v.type)) return bad('COMMAND_NOT_ALLOWED', `Comando ${v.type} não é aceito do cliente`, commandId);
  const shape = SHAPES[v.type];
  if (!shape) return bad('INVALID_FORMAT', `Tipo desconhecido: ${v.type}`, commandId);
  if (v.expectedTurnId !== undefined && !isInt(v.expectedTurnId, 0, 1_000_000)) return bad('INVALID_FORMAT', 'expectedTurnId inválido', commandId);
  for (const key of Object.keys(v)) {
    if (!ENVELOPE.has(key) && !(key in shape)) return bad('INVALID_FORMAT', `Campo não permitido: ${key}`, commandId);
  }
  for (const [key, check] of Object.entries(shape)) {
    if (!check(v[key])) return bad('INVALID_FORMAT', `Campo inválido: ${key}`, commandId);
  }
  return { ok: true, command: value as ClientCommand };
}

/** Validação estrutural (compatibilidade com a Fase 1). */
export function isClientCommand(value: unknown): value is ClientCommand {
  return parseClientCommand(value).ok;
}

/** Comando do domínio sem o envelope de rede. */
export function stripEnvelope(command: ClientCommand): GameplayCommand {
  const { protocolVersion: _p, commandId: _c, ...rest } = command;
  return rest as GameplayCommand;
}

// ---------------------------------------------------------------------------
// Hash do estado (detecção de divergência)
// ---------------------------------------------------------------------------

/** JSON com chaves ordenadas (mesma saída no navegador e no Node). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** cyrb53 (53 bits) em hexadecimal: rápido e suficiente para comparar estados. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export const stateHash = (state: GameState): string => hashString(stableStringify(state));
