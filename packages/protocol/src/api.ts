/**
 * Fase 5: contrato da API HTTP do ciclo de jogo (conta, personagem, inventário, loja, missões,
 * histórico, lobby). Autenticação: `Authorization: Bearer <token>` (POST /auth/login ou
 * /auth/register). Todas as decisões (preço, posse, recompensa, progresso) são do servidor.
 *
 *   POST   /auth/register            { username, password, displayName? } → LoginResponse
 *   POST   /auth/login               { username, password } → LoginResponse
 *   POST   /auth/logout              encerra a sessão
 *   GET    /me                       → MeResponse
 *   POST   /characters               CharacterInput → CharacterDto (cria e seleciona)
 *   PATCH  /characters/:id           Partial<CharacterInput> (sem classe/nome) → CharacterDto (equipar)
 *   POST   /characters/:id/select    → MeResponse
 *   GET    /shop                     → ShopItemDto[]
 *   POST   /shop/buy                 { productId, requestId } → BuyResponse (idempotente por requestId)
 *   GET    /missions                 → MissionDto[]
 *   GET    /matches/history          → HistoryEntryDto[]
 *   GET    /matches/:id/reward       → MatchRewardDto (a recompensa desta conta na partida)
 *   GET    /lobby/status             → LobbyStatusDto (fila, convites, partida encontrada)
 *   POST   /lobby/bot                { difficulty } → { roomId }
 *   POST   /lobby/queue              entra na fila de matchmaking
 *   DELETE /lobby/queue              sai da fila
 *   POST   /lobby/invites            { to } (usuário ou código de amigo) → InviteDto
 *   POST   /lobby/invites/:id/accept → { roomId }
 *   POST   /lobby/invites/:id/decline
 */

export interface AccountDto {
  id: string;
  username: string;
  displayName: string;
  /** Código de amigo (convites). */
  friendCode: string;
  coins: number;
  activeCharacterId: string | null;
}

/** Cosméticos equipados por espaço (`color`, `outfit`, `portrait`, `frame`, `aura`). */
export type AppearanceDto = Record<string, string>;

export interface CharacterDto {
  id: string;
  name: string;
  classId: string;
  appearance: AppearanceDto;
  accessoryId: string | null;
  consumables: string[];
}

export interface CharacterInput {
  name: string;
  classId: string;
  appearance?: AppearanceDto;
  accessoryId?: string | null;
  consumables?: string[];
}

export interface MeResponse {
  account: AccountDto;
  characters: CharacterDto[];
  /** Cosméticos desbloqueados (ids). */
  inventory: string[];
}

export interface ShopItemDto {
  id: string;
  slot: string;
  name: string;
  description: string;
  price: number;
  owned: boolean;
}

export interface BuyResponse {
  ok: boolean;
  productId: string;
  balance: number;
  /** Repetição do mesmo `requestId`: devolve o resultado gravado. */
  duplicate: boolean;
  error?: string;
}

export interface MissionDto {
  id: string;
  name: string;
  description: string;
  period: 'permanent' | 'daily';
  target: number;
  progress: number;
  completed: boolean;
  reward: { coins?: number; cosmeticId?: string; cosmeticName?: string };
}

export interface MissionChangeDto {
  id: string;
  name: string;
  before: number;
  after: number;
  target: number;
  completedNow: boolean;
  reward: { coins?: number; cosmeticId?: string; cosmeticName?: string };
}

export interface MatchRewardDto {
  matchId: string;
  mode: string;
  outcome: 'victory' | 'defeat' | 'draw';
  coins: number;
  /** Moedas das missões concluídas nesta partida. */
  missionCoins: number;
  /** Saldo depois de creditar. */
  balance: number;
  stats: { damageDealt: number; barrelsDetonated: number; rounds: number; surrendered: boolean; completed: boolean };
  missions: MissionChangeDto[];
  /** Cosméticos desbloqueados por missões nesta partida. */
  unlocked: string[];
}

export interface HistoryEntryDto {
  matchId: string;
  mode: string;
  botDifficulty: string | null;
  finishedAt: string;
  outcome: 'victory' | 'defeat' | 'draw';
  reason: string | null;
  coins: number;
  rounds: number | null;
  character: { name: string; classId: string } | null;
  opponent: { name: string; classId: string | null; username: string } | null;
}

export interface InviteDto {
  id: string;
  from: { username: string; displayName: string };
  to: { username: string; displayName: string };
  createdAt: number;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
}

export interface LobbyStatusDto {
  queue: { since: number; waitingSeconds: number; size: number } | null;
  invites: { incoming: InviteDto[]; outgoing: InviteDto[] };
  /** Partida criada para esta conta (fila, convite aceito ou bot) — entrar com `joinById`. */
  match: { roomId: string; mode: string } | null;
}

export interface ApiError {
  error: string;
}
