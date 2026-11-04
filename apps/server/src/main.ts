/**
 * Servidor de jogo (Fase 3): `npm run server` → http://127.0.0.1:2567 (WebSocket + HTTP).
 * Variáveis: PORT, HOST, DATA_DIR (.data/pg | memory), DATABASE_URL, TURN_SECONDS,
 * RECONNECT_SECONDS, ABANDON_SECONDS, GAME_DEV=0 (desliga /debug e opções de dev), BOT_DELAY_MS,
 * Fase 6: JOIN_TIMEOUT_SECONDS (prazo para entrar na partida montada, 45), FORFEIT_ON_ABANDON=0
 * (desliga a derrota por abandono), AUTH_RATE_LIMIT=0 / LOGIN_FAILURES_PER_USER (8) /
 * LOGIN_PER_IP_PER_MINUTE (30) / REGISTER_PER_IP_PER_10MIN (30).
 */
import { createGameServer } from './app.js';

const server = await createGameServer();
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
