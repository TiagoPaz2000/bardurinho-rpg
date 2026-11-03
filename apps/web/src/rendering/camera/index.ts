/**
 * Sistema de câmera da partida (seção 14). Exclusivamente do cliente: nenhum componente
 * daqui altera o GameState nem é enviado ao servidor (seção 14.4).
 */
export { CameraBounds, type CameraBoundsConfig } from './CameraBounds.js';
export { CameraController, type CameraOrientation } from './CameraController.js';
export { CameraEventQueue, type AutoCameraPreference, type CameraShot } from './CameraEventQueue.js';
export { CameraFocus, FOCUS_RADIUS } from './CameraFocus.js';
export { CameraInput, type CameraInputActions } from './CameraInput.js';
export { CameraOcclusion } from './CameraOcclusion.js';
export { damp, TRANSITION_RATES } from './CameraTransitions.js';
