/**
 * Conexão com o servidor de jogo: login (POST /auth/login), entrada na sala (Colyseus) e
 * retomada depois de recarregar a página (token de reconexão em `sessionStorage`).
 * Sem DOM nem Babylon além do `sessionStorage` opcional: também usado pelo e2e em Node.
 */
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_SERVER_PORT, MATCH_ROOM, type LoginResponse, type SnapshotMessage } from '@bardurinho/protocol';
import { bufferEarly } from './early.js';

export const defaultServerUrl = (): string => {
  const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
  return `http://${host || '127.0.0.1'}:${DEFAULT_SERVER_PORT}`;
};

export async function login(serverUrl: string, username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${serverUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = (await res.json().catch(() => ({}))) as LoginResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Falha no login (${res.status})`);
  return body;
}

export interface RoomListing {
  roomId: string;
  clients: number;
  locked: boolean;
  private: boolean;
  metadata?: { matchId?: string; status?: string; teamSize?: number | null; seats?: Array<{ username: string | null; connected: boolean; team: string }> };
}

export async function listRooms(serverUrl: string): Promise<RoomListing[]> {
  const res = await fetch(`${serverUrl}/rooms`);
  return (await res.json()) as RoomListing[];
}

/** Primeiro snapshot da sala (chega logo depois da entrada). */
export function waitSnapshot(room: Room, timeoutMs = 10000): Promise<SnapshotMessage> {
  // Presença pode chegar antes de a partida ligar os próprios ouvintes (evita o aviso do SDK).
  room.onMessage('presence', () => undefined);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error('O servidor não enviou o snapshot da partida'));
    }, timeoutMs);
    const off = room.onMessage('snapshot', (msg: SnapshotMessage) => {
      clearTimeout(t);
      off();
      // Fase 6: o que chegar daqui até a partida ligar os ouvintes fica guardado (ver early.ts).
      bufferEarly(room);
      resolve(msg);
    });
  });
}

export interface JoinOptions {
  /** Só com o servidor em modo dev. */
  seed?: number;
  turnSeconds?: number;
  /** Fase 4: formato da sala (1 = 1 × 1, 2 = 2 × 2) e escolha de personagens do jogador. */
  teamSize?: number;
  team?: Array<{ classId: string; accessoryId?: string | null; consumables?: string[] }>;
}

export interface Joined {
  client: Client;
  room: Room;
  snapshot: SnapshotMessage;
}

/**
 * Procura uma sala aberta ou cria uma (`joinOrCreate`); `roomId` entra numa sala específica;
 * `create` sempre cria uma sala nova (testes).
 */
export async function joinMatch(serverUrl: string, token: string, opts: JoinOptions & { roomId?: string; create?: boolean } = {}): Promise<Joined> {
  const client = new Client(serverUrl);
  const { roomId, create, ...rest } = opts;
  const room = roomId
    ? await client.joinById(roomId, { token, ...rest })
    : create
      ? await client.create(MATCH_ROOM, { token, ...rest })
      : await client.joinOrCreate(MATCH_ROOM, { token, ...rest });
  // Fase 6: o SDK só reconecta sozinho se a sala estava aberta havia 5 s; uma queda logo depois
  // de entrar deixava o cliente "offline" para sempre (achado no teste com quedas de conexão).
  // O servidor guarda a vaga (reserva) e os comandos têm commandId: reconectar já é seguro.
  room.reconnection.minUptime = 0;
  const snapshot = await waitSnapshot(room);
  return { client, room, snapshot };
}

// ---------------------------------------------------------------------------
// Sessão salva no navegador (recarregar a página volta à mesma partida)
// ---------------------------------------------------------------------------

export interface SavedSession {
  serverUrl: string;
  token: string;
  username: string;
  roomId?: string;
  reconnectionToken?: string;
}

const KEY = 'bardurinho.rede';

const storage = (): Storage | null => (typeof sessionStorage !== 'undefined' ? sessionStorage : null);

/** `key`: chave do `sessionStorage` (o lobby de desenvolvimento usa `bardurinho.rede`; o ciclo de jogo, `bardurinho.jogo`). */
export function loadSession(key = KEY): SavedSession | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: SavedSession | null, key = KEY): void {
  if (!s) storage()?.removeItem(key);
  else storage()?.setItem(key, JSON.stringify(s));
}

/** Volta à partida salva: token de reconexão (reserva de vaga) ou, se expirou, `joinById` com a conta. */
export async function resumeMatch(saved: SavedSession): Promise<Joined | null> {
  if (!saved.roomId) return null;
  const client = new Client(saved.serverUrl);
  if (saved.reconnectionToken) {
    try {
      const room = await client.reconnect(saved.reconnectionToken);
      return { client, room, snapshot: await waitSnapshot(room) };
    } catch {
      /* reserva expirada: tenta pela conta */
    }
  }
  try {
    const room = await client.joinById(saved.roomId, { token: saved.token });
    return { client, room, snapshot: await waitSnapshot(room) };
  } catch {
    return null;
  }
}

/** Guarda sala + token de reconexão (atualiza a cada reconexão automática do SDK). */
export function rememberRoom(saved: SavedSession, room: Room, key = KEY): void {
  const write = () => saveSession({ ...saved, roomId: room.roomId, reconnectionToken: room.reconnectionToken }, key);
  write();
  room.onReconnect(() => write());
}
