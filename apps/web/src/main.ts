/**
 * Cliente web 3D (Babylon.js) — Fase 2.
 * Etapa 1: Pátio das Ruínas renderizado a partir do core + câmera tática + HUD mínimo.
 * Etapa 2: seleção, destaques, movimento animado e encerrar turno (MatchController).
 */
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { pace } from './rendering/anim.js';
import { startArenaScreen } from './screens/arenaScreen.js';
import './style.css';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const screen = startArenaScreen(canvas, hudRoot, catalog, patioDasRuinas);

// Gancho de depuração (console / screenshots automatizados).
(window as unknown as { __arena: typeof screen }).__arena = screen;
// Ritmo das animações (capturas: `__pace.speed = 0.25` desacelera 4×).
(window as unknown as { __pace: typeof pace }).__pace = pace;

screen.ready
  .then(() => {
    document.body.dataset.ready = '1';
  })
  .catch((err: unknown) => {
    console.error('Falha ao carregar modelos:', err);
    const box = document.createElement('div');
    box.className = 'hud-panel hud-error';
    box.textContent = `Falha ao carregar modelos: ${String(err)}`;
    hudRoot.append(box);
    document.body.dataset.ready = 'error';
  });
