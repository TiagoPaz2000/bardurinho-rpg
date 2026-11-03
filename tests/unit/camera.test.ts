import { describe, expect, it } from 'vitest';
import { CameraEventQueue, type CameraShot } from '../../apps/web/src/rendering/camera/CameraEventQueue.js';
import { boxContains, findOccluders, segmentHitsBox, type Box } from '../../apps/web/src/rendering/camera/occlusionMath.js';

/** Posição da câmera tática (ArcRotate, β = 45°) focando `target` na orientação 0° (câmera em +Z). */
function cameraAt0(target: { x: number; y: number; z: number }, radius = 28) {
  const s = Math.sin(Math.PI / 4);
  return { x: target.x, y: target.y + radius * Math.cos(Math.PI / 4), z: target.z + radius * s };
}
/** Centro da célula (convenção X = x·2+1, Z = y·2+1, Y = andar·4) + altura. */
const cell = (x: number, y: number, lift = 0, floor = 0) => ({ x: x * 2 + 1, y: floor * 4 + lift, z: y * 2 + 1 });
/** Segmento do muro central do Pátio entre o portão (7,7) e a porta (13,7): x 8–12, 3 m. */
const wall: Box = { min: { x: 16, y: 0, z: 14 }, max: { x: 26, y: 3, z: 16 } };

describe('Oclusão da câmera (14.7) — geometria', () => {
  it('a 0°, o muro central cobre um personagem logo ao norte dele, mas não um mais distante', () => {
    const cam = cameraAt0(cell(8, 12));
    expect(segmentHitsBox(cam, cell(10, 6, 1.75), wall)).toBe(true);
    expect(segmentHitsBox(cam, cell(10, 2, 1.75), wall)).toBe(false);
    // Personagem ao sul do muro (lado da câmera): nada no caminho.
    expect(segmentHitsBox(cam, cell(10, 9, 1.0), wall)).toBe(false);
  });

  it('a 180° (câmera ao norte), o mesmo muro deixa de cobrir o personagem ao norte', () => {
    const t = cell(8, 3);
    const s = Math.sin(Math.PI / 4) * 28;
    const cam = { x: t.x, y: 28 * Math.cos(Math.PI / 4), z: t.z - s };
    expect(segmentHitsBox(cam, cell(10, 6, 1.75), wall)).toBe(false);
  });

  it('findOccluders ignora a própria entidade e estruturas que contêm o alvo', () => {
    const cam = cameraAt0(cell(8, 12));
    const door = { min: { x: 26, y: 0, z: 14 }, max: { x: 28, y: 2.6, z: 16 }, entityId: 'door-02' };
    const targets = [
      { ...cell(10, 6, 1.75), entityId: 'warrior-01' },
      // A própria porta como alvo (ex.: mira em "Abrir porta") não a esmaece.
      { x: 27, y: 1, z: 15, entityId: 'door-02' },
    ];
    const hit = findOccluders(cam, targets, [wall, door]);
    expect([...hit]).toEqual([0]);
    expect(boxContains(door, { x: 27, y: 1, z: 15 })).toBe(true);
  });

  it('encurtar o fim do raio evita contar o piso sob os pés', () => {
    const slab: Box = { min: { x: 0, y: 3.6, z: 8 }, max: { x: 4, y: 4, z: 20 } };
    const cam = cameraAt0(cell(1, 6, 0, 1));
    expect(segmentHitsBox(cam, cell(1, 6, 0.2, 1), slab, 0.35)).toBe(false);
    // Personagem no térreo sob a plataforma: a laje cobre.
    expect(segmentHitsBox(cam, cell(1, 6, 1.75, 0), slab, 0.35)).toBe(true);
  });
});

const shot = (over: Partial<CameraShot>): CameraShot => ({ eventType: 'X', priority: 1, durationHint: 0.5, interruptible: true, targetCell: { x: 0, y: 0, floor: 0 }, ...over });

describe('CameraEventQueue (14.10–14.13)', () => {
  const setup = () => {
    const q = new CameraEventQueue();
    const ran: string[] = [];
    q.runner = (s) => ran.push(s.eventType);
    q.begin();
    return { q, ran };
  };

  it('tomada de prioridade maior segura a câmera; a menor fica adiada e roda depois', () => {
    const { q, ran } = setup();
    q.enqueue(shot({ eventType: 'EXPLOSION', priority: 2, durationHint: 1.4, radius: 30 }));
    q.enqueue(shot({ eventType: 'UNIT_MOVED' }));
    q.enqueue(shot({ eventType: 'return.control', radius: 'restore' }));
    expect(ran).toEqual(['EXPLOSION']);
    expect(q.pending.map((s) => s.eventType)).toEqual(['return.control']);
    q.update(1.0);
    expect(ran).toEqual(['EXPLOSION']);
    q.update(0.5);
    expect(ran).toEqual(['EXPLOSION', 'return.control']);
  });

  it('prioridade igual ou maior roda na hora', () => {
    const { q, ran } = setup();
    q.enqueue(shot({ eventType: 'A', priority: 1, durationHint: 2 }));
    q.enqueue(shot({ eventType: 'B', priority: 1 }));
    q.enqueue(shot({ eventType: 'C', priority: 2 }));
    expect(ran).toEqual(['A', 'B', 'C']);
  });

  it('interrupção manual descarta adiadas e futuras interrompíveis até a próxima reprodução', () => {
    const { q, ran } = setup();
    q.enqueue(shot({ eventType: 'EXPLOSION', priority: 2, durationHint: 1 }));
    q.enqueue(shot({ eventType: 'return.control' }));
    q.interrupt();
    q.update(2);
    q.enqueue(shot({ eventType: 'UNIT_MOVED' }));
    expect(ran).toEqual(['EXPLOSION']);
    q.begin();
    q.enqueue(shot({ eventType: 'UNIT_MOVED' }));
    expect(ran).toEqual(['EXPLOSION', 'UNIT_MOVED']);
  });

  it('preferência reduzida: só eventos grandes; o retorno só roda se a câmera saiu', () => {
    const { q, ran } = setup();
    q.preference = 'reduced';
    q.enqueue(shot({ eventType: 'UNIT_MOVED' }));
    q.enqueue(shot({ eventType: 'return.control' }));
    expect(ran).toEqual([]);
    q.enqueue(shot({ eventType: 'EXPLOSION', priority: 2, durationHint: 0 }));
    q.enqueue(shot({ eventType: 'return.control' }));
    expect(ran).toEqual(['EXPLOSION', 'return.control']);
  });

  it('preferência desativada: nada, exceto tomadas indispensáveis', () => {
    const { q, ran } = setup();
    q.preference = 'off';
    q.enqueue(shot({ eventType: 'EXPLOSION', priority: 2 }));
    q.enqueue(shot({ eventType: 'return.control' }));
    q.enqueue(shot({ eventType: 'MATCH_START', essential: true, interruptible: false }));
    expect(ran).toEqual(['MATCH_START']);
  });
});
