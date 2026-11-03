/**
 * Cliente web 3D (Babylon.js) — Fase 2.
 * Etapa 1: Pátio das Ruínas renderizado a partir do core + câmera tática + HUD mínimo.
 */
import { catalog, patioDasRuinas } from '@bardurinho/content';
import { startArenaScreen } from './screens/arenaScreen.js';
import './style.css';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const screen = startArenaScreen(canvas, hudRoot, catalog, patioDasRuinas);

// Gancho de depuração (console / screenshots automatizados).
(window as unknown as { __arena: typeof screen }).__arena = screen;

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
