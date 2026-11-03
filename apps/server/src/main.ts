/**
 * Servidor de jogo (Fase 3): `npm run server` → http://127.0.0.1:2567 (WebSocket + HTTP).
 * Variáveis: PORT, HOST, DATA_DIR (.data/pg | memory), DATABASE_URL, TURN_SECONDS,
 * RECONNECT_SECONDS, ABANDON_SECONDS, GAME_DEV=0 (desliga /debug e opções de dev).
 */
import { createGameServer } from './app.js';

const server = await createGameServer();
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
