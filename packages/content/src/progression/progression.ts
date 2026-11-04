/**
 * Progressão (Fase 5, seção 12.3): moedas por partida, missões e regras do personagem.
 * Só dados e funções puras: o servidor calcula a recompensa a partir do resultado oficial
 * (estado final + eventos persistidos) e grava de forma idempotente.
 */
import { summarizeMatch, type GameEvent, type GameState } from '@bardurinho/domain';

// ---------------------------------------------------------------------------
// Economia
// ---------------------------------------------------------------------------

/** Moedas de boas-vindas ao criar a conta (permite a primeira compra na loja). */
export const WELCOME_COINS = 100;

/** Modo da partida: PvP pela fila, PvP por convite, contra bot ou personalizada (lobby de desenvolvimento). */
export type MatchMode = 'pvp' | 'private' | 'bot' | 'custom';
export type BotDifficultyId = 'easy' | 'normal' | 'hard';
export type MatchOutcome = 'victory' | 'defeat' | 'draw';

/**
 * Tabela da seção 12.3: vitória PvP 30, derrota PvP concluída 10, empate 15, vitória contra
 * bot 10. Decisões (o plano não fixa): empate contra bot 5, derrota contra bot 3 (partida
 * concluída); quem se rende não recebe moedas; partidas personalizadas (lobby de
 * desenvolvimento) não dão moedas.
 */
export const REWARD_TABLE: Record<Exclude<MatchMode, 'custom'>, Record<MatchOutcome, number>> = {
  pvp: { victory: 30, defeat: 10, draw: 15 },
  private: { victory: 30, defeat: 10, draw: 15 },
  bot: { victory: 10, defeat: 3, draw: 5 },
};

export function matchCoins(mode: MatchMode, outcome: MatchOutcome, surrendered: boolean): number {
  if (mode === 'custom' || surrendered) return 0;
  return REWARD_TABLE[mode][outcome];
}

// ---------------------------------------------------------------------------
// Estatísticas de um participante (a partir do resultado oficial)
// ---------------------------------------------------------------------------

export interface ParticipantStats {
  team: string;
  outcome: MatchOutcome;
  /** A própria equipe se rendeu (não conta como partida concluída). */
  surrendered: boolean;
  /** Partida concluída: terminou e o jogador não se rendeu. */
  completed: boolean;
  damageDealt: number;
  barrelsDetonated: number;
  rounds: number;
}

/** Estatísticas de uma equipe numa partida encerrada (estado final oficial + eventos oficiais). */
export function participantStats(finalState: GameState, events: readonly GameEvent[], team: string): ParticipantStats {
  const r = finalState.result;
  const outcome: MatchOutcome = !r || r.kind === 'draw' ? 'draw' : r.winnerTeam === team ? 'victory' : 'defeat';
  const surrendered = !!r && r.kind === 'victory' && r.reason === 'surrender' && r.winnerTeam !== team;
  const sum = summarizeMatch(finalState, events);
  const mine = sum.units.filter((u) => u.team === team);
  return {
    team,
    outcome,
    surrendered,
    completed: finalState.status === 'finished' && !surrendered,
    damageDealt: mine.reduce((s, u) => s + u.damageDealt, 0),
    barrelsDetonated: mine.reduce((s, u) => s + u.barrelsDetonated, 0),
    rounds: sum.rounds,
  };
}

// ---------------------------------------------------------------------------
// Missões (seção 12.3 "Missões iniciais" + duas diárias simples)
// ---------------------------------------------------------------------------

export type MissionMetric = 'matchesCompleted' | 'wins' | 'barrelsDetonated' | 'damageDealt';

export interface MissionDefinition {
  id: string;
  name: string;
  description: string;
  /** Permanente (uma vez por conta) ou diária (renova a cada dia, UTC). */
  period: 'permanent' | 'daily';
  metric: MissionMetric;
  target: number;
  reward: { coins?: number; cosmeticId?: string };
}

export const missions: MissionDefinition[] = [
  { id: 'mission.complete_three', name: 'Concluir três partidas', description: 'Termine três partidas (sem se render).', period: 'permanent', metric: 'matchesCompleted', target: 3, reward: { cosmeticId: 'color.veteran' } },
  { id: 'mission.first_win', name: 'Obter a primeira vitória', description: 'Vença uma partida (PvP ou contra bot).', period: 'permanent', metric: 'wins', target: 1, reward: { cosmeticId: 'frame.gold' } },
  { id: 'mission.two_barrels', name: 'Incendiar dois barris', description: 'Detone dois barris em partidas concluídas.', period: 'permanent', metric: 'barrelsDetonated', target: 2, reward: { cosmeticId: 'aura.ember' } },
  { id: 'daily.play_one', name: 'Partida do dia', description: 'Conclua uma partida hoje.', period: 'daily', metric: 'matchesCompleted', target: 1, reward: { coins: 20 } },
  { id: 'daily.damage', name: 'Mão pesada', description: 'Cause 60 de dano em personagens hoje.', period: 'daily', metric: 'damageDealt', target: 60, reward: { coins: 15 } },
];

export const missionsById: Record<string, MissionDefinition> = Object.fromEntries(missions.map((m) => [m.id, m]));

/** Período corrente da missão: `perm` ou a data UTC (`2026-11-03`). */
export const missionPeriod = (m: MissionDefinition, now: Date = new Date()): string => (m.period === 'permanent' ? 'perm' : now.toISOString().slice(0, 10));

/** Quanto a partida soma na métrica da missão (só partidas concluídas contam). */
export function missionIncrement(m: MissionDefinition, s: ParticipantStats): number {
  if (!s.completed) return 0;
  switch (m.metric) {
    case 'matchesCompleted':
      return 1;
    case 'wins':
      return s.outcome === 'victory' ? 1 : 0;
    case 'barrelsDetonated':
      return s.barrelsDetonated;
    case 'damageDealt':
      return s.damageDealt;
  }
}

// ---------------------------------------------------------------------------
// Personagem (seção 12.1)
// ---------------------------------------------------------------------------

export const MAX_CHARACTERS_PER_ACCOUNT = 3;
export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;

/** Nome do personagem: 3–16 caracteres, letras (com acento), dígitos, espaço, hífen ou apóstrofo. */
export function characterNameProblem(name: unknown): string | null {
  if (typeof name !== 'string') return 'Informe um nome';
  const n = name.trim();
  if (n.length < CHARACTER_NAME_MIN || n.length > CHARACTER_NAME_MAX) return `O nome precisa ter de ${CHARACTER_NAME_MIN} a ${CHARACTER_NAME_MAX} caracteres`;
  if (!/^[\p{L}\d][\p{L}\d '-]*$/u.test(n)) return 'Use só letras, números, espaço, hífen ou apóstrofo';
  return null;
}

/** Usuário da conta: 3–20 caracteres minúsculos `a-z0-9_-`. */
export function usernameProblem(username: unknown): string | null {
  if (typeof username !== 'string') return 'Informe um usuário';
  if (!/^[a-z0-9_-]{3,20}$/.test(username)) return 'Usuário: 3 a 20 caracteres (letras minúsculas, números, _ ou -)';
  return null;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres';
  if (password.length > 128) return 'Senha longa demais';
  return null;
}
