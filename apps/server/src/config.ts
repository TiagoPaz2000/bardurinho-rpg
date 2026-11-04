/**
 * Configuração do servidor de jogo (variáveis de ambiente; padrões da seção 10.1).
 */
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SERVER_PORT } from '@bardurinho/protocol';

/** Build de produção do cliente web (vite build), servido pelo próprio servidor na Fase 7. */
export const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export interface ServerConfig {
  host: string;
  port: number;
  /** `postgres://…` usa um PostgreSQL externo (driver pg); vazio usa PGlite. */
  databaseUrl: string | undefined;
  /** Pasta do PGlite (`memory` = em memória). */
  dataDir: string;
  /** Duração do turno (s): ao esgotar, o servidor encerra o turno sozinho. */
  turnSeconds: number;
  /** Reserva da vaga após uma queda (s) — seção 11.5. */
  reconnectSeconds: number;
  /** Sala sem nenhum jogador conectado por este tempo (s) é encerrada (partida abandonada). */
  abandonSeconds: number;
  /** Fase 5: pausa do bot entre comandos (ms), para o jogador acompanhar as animações. */
  botDelayMs: number;
  /**
   * Fase 6: prazo (s) para os jogadores de uma partida montada (fila/convite) entrarem na sala;
   * esgotado, a partida é cancelada e quem entrou (ou continua no lobby) volta à fila.
   */
  joinTimeoutSeconds: number;
  /**
   * Fase 6: abandono = derrota. Quem caiu e não voltou dentro da reserva (`reconnectSeconds`)
   * perde a partida por desistência (só se o adversário estiver conectado ou for bot).
   */
  forfeitOnAbandon: boolean;
  /** Fase 6: limites de autenticação por IP/usuário (0 desliga). */
  rateLimit: { loginFailuresPerUser: number; loginPerIpPerMinute: number; registerPerIpPer10Min: number };
  /**
   * Rotas e opções de desenvolvimento: `/debug/*` (modo NETWORK do Combat Debug Lab), semente
   * e duração de turno escolhidas pelo cliente ao criar a sala. Desligado em produção.
   */
  dev: boolean;
  /** Contas de desenvolvimento criadas na inicialização (senha `dev`). */
  devAccounts: Array<{ username: string; displayName: string; password: string }>;
  /** Origens aceitas pelo CORS das rotas HTTP. */
  corsOrigins: string[];
  log: boolean;
  /**
   * Fase 7 (teste externo): tela de consentimento, telemetria do cliente, pesquisa pós-partida e
   * "reportar bug". Padrão: ligado em produção, desligado em desenvolvimento (`PLAYTEST=1/0`).
   */
  playtest: boolean;
  /** Fase 7: cadastro aberto, só com código de convite (padrão em produção) ou fechado. */
  registration: 'open' | 'invite' | 'closed';
  /** Fase 7: códigos de convite criados na inicialização (`INVITE_CODES=ABC:10,XYZ` → código:usos). */
  inviteCodes: Array<{ code: string; maxUses: number }>;
  /**
   * Fase 7: token do painel/API de administração (`/admin`). Sem `ADMIN_TOKEN`: em produção é
   * gerado na inicialização (aparece no log); em desenvolvimento o painel fica desligado.
   */
  adminToken: string | null;
  adminTokenGenerated: boolean;
  /** Fase 7: pasta do cliente web de produção servida na mesma porta (`STATIC_DIR`; `none` desliga). */
  staticDir: string | null;
  /** Fase 7: atrás de túnel/proxy reverso, IP do cliente pelo X-Forwarded-For (`TRUST_PROXY=1`). */
  trustProxy: boolean;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dev = env.NODE_ENV !== 'production' && env.GAME_DEV !== '0';
  const flag = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v !== '0' && v.toLowerCase() !== 'false');
  const registration = env.REGISTRATION === 'open' || env.REGISTRATION === 'invite' || env.REGISTRATION === 'closed' ? env.REGISTRATION : dev ? 'open' : 'invite';
  const adminToken = env.ADMIN_TOKEN?.trim() || (dev ? null : randomBytes(18).toString('base64url'));
  const staticDir = env.STATIC_DIR === 'none' ? null : env.STATIC_DIR ? env.STATIC_DIR : !dev && existsSync(`${WEB_DIST}index.html`) ? WEB_DIST : null;
  return {
    host: env.HOST ?? '127.0.0.1',
    port: num(env.PORT, DEFAULT_SERVER_PORT),
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR ?? '.data/pg',
    turnSeconds: num(env.TURN_SECONDS, 60),
    reconnectSeconds: num(env.RECONNECT_SECONDS, 90),
    abandonSeconds: num(env.ABANDON_SECONDS, 600),
    botDelayMs: num(env.BOT_DELAY_MS, 700),
    joinTimeoutSeconds: num(env.JOIN_TIMEOUT_SECONDS, 45),
    forfeitOnAbandon: env.FORFEIT_ON_ABANDON !== '0',
    rateLimit: env.AUTH_RATE_LIMIT === '0'
      ? { loginFailuresPerUser: 0, loginPerIpPerMinute: 0, registerPerIpPer10Min: 0 }
      : { loginFailuresPerUser: num(env.LOGIN_FAILURES_PER_USER, 8), loginPerIpPerMinute: num(env.LOGIN_PER_IP_PER_MINUTE, 30), registerPerIpPer10Min: num(env.REGISTER_PER_IP_PER_10MIN, 30) },
    dev,
    devAccounts: dev
      ? [
          { username: 'jogador-a', displayName: 'Jogador A', password: 'dev' },
          { username: 'jogador-b', displayName: 'Jogador B', password: 'dev' },
        ]
      : [],
    corsOrigins: (env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174').split(','),
    log: env.GAME_LOG !== '0',
    playtest: flag(env.PLAYTEST, !dev),
    registration,
    inviteCodes: (env.INVITE_CODES ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [code, uses] = x.split(':');
        return { code: code!.toUpperCase(), maxUses: Math.max(1, num(uses, 1)) };
      }),
    adminToken,
    adminTokenGenerated: !!adminToken && !env.ADMIN_TOKEN?.trim(),
    staticDir,
    trustProxy: env.TRUST_PROXY === '1',
    ...overrides,
  };
}
