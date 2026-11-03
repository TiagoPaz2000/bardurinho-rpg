import type { ScenarioInitial } from '@bardurinho/domain';

export interface MapDefinition {
  id: string;
  version: number;
  name: string;
  tags: string[];
  description: string;
  /** Mapa + objetos + superfícies iniciais + personagens de exemplo nos pontos de início. */
  scenario: ScenarioInitial;
}

/*
 * Pátio das Ruínas (seção 6): térreo 16 × 16, duas plataformas elevadas 6 × 2 no
 * andar 1 (4 m acima), uma escada por plataforma, muro central com duas portas e um
 * portão controlado por alavanca. Distribuição aproximadamente simétrica (rotação de 180°).
 *
 * Térreo: `.` chão · `#` parede · `d` área escura. Andar 1: `_` vazio (ar) · `.` plataforma.
 * As plataformas ficam sobre o muro: sob elas, no térreo, o muro continua (pilares).
 */
const GROUND = [
  '..............dd', // 0  ponto de início A (7,0); alcova escura (14–15, 0–1)
  '..............dd', // 1
  '................', // 2
  '................', // 3
  '................', // 4
  '................', // 5
  '................', // 6
  '##.####.#####.##', // 7  muro central: portas (2,7) e (13,7), portão (7,7)
  '................', // 8
  '................', // 9
  '................', // 10
  '................', // 11
  '................', // 12
  '................', // 13
  'dd..............', // 14 alcova escura (0–1, 14–15)
  'dd..............', // 15 ponto de início B (8,15)
];

const PLATFORMS = Array.from({ length: 16 }, (_, y) => {
  const left = y >= 4 && y <= 9 ? '..' : '__';
  const right = y >= 6 && y <= 11 ? '..' : '__';
  return `${left}${'_'.repeat(12)}${right}`;
});

export const patioDasRuinas: MapDefinition = {
  id: 'map.patio_das_ruinas',
  version: 1,
  name: 'Pátio das Ruínas',
  tags: ['MVP', 'ARENA', 'MULTI_FLOOR'],
  description: 'Arena do MVP: 16×16, duas plataformas elevadas, muro central com portas e portão.',
  scenario: {
    name: 'Pátio das Ruínas',
    map: {
      floors: [GROUND, PLATFORMS],
      connections: [
        // Escadas: atravessar a ligação custa 2 PM.
        { a: { x: 0, y: 3, floor: 0 }, b: { x: 0, y: 4, floor: 1 }, cost: 2 },
        { a: { x: 15, y: 12, floor: 0 }, b: { x: 15, y: 11, floor: 1 }, cost: 2 },
      ],
    },
    units: [
      { id: 'warrior-01', classId: 'warrior', team: 'A', pos: { x: 7, y: 0 } },
      { id: 'mage-01', classId: 'mage', team: 'B', pos: { x: 8, y: 15 } },
    ],
    objects: [
      { id: 'door-01', defId: 'door', pos: { x: 2, y: 7 } },
      { id: 'door-02', defId: 'door', pos: { x: 13, y: 7 } },
      { id: 'gate-01', defId: 'gate', pos: { x: 7, y: 7 } },
      { id: 'lever-01', defId: 'lever', pos: { x: 8, y: 6 }, linkedId: 'gate-01' },
      { id: 'barrel-01', defId: 'barrel', pos: { x: 5, y: 5 } },
      { id: 'barrel-02', defId: 'barrel', pos: { x: 10, y: 10 } },
      { id: 'barrel-03', defId: 'barrel', pos: { x: 4, y: 10 } },
      { id: 'barrel-04', defId: 'barrel', pos: { x: 11, y: 5 } },
      { id: 'crate-01', defId: 'crate', pos: { x: 6, y: 3 } },
      { id: 'crate-02', defId: 'crate', pos: { x: 9, y: 12 } },
      { id: 'crate-03', defId: 'crate', pos: { x: 3, y: 11 } },
      { id: 'crate-04', defId: 'crate', pos: { x: 12, y: 4 } },
      { id: 'cistern-01', defId: 'cistern', pos: { x: 9, y: 2 } },
      { id: 'cistern-02', defId: 'cistern', pos: { x: 6, y: 13 } },
      { id: 'chest-01', defId: 'chest', pos: { x: 14, y: 4 } },
      { id: 'chest-02', defId: 'chest', pos: { x: 1, y: 11 } },
      { id: 'altar-01', defId: 'focus_altar', pos: { x: 1, y: 1 } },
      { id: 'altar-02', defId: 'focus_altar', pos: { x: 14, y: 14 } },
    ],
    surfaces: [
      // Duas manchas iniciais de óleo, três células cada, junto a barris.
      { cells: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], surface: 'oil' },
      { cells: [{ x: 11, y: 9 }, { x: 11, y: 10 }, { x: 11, y: 11 }], surface: 'oil' },
    ],
    order: ['warrior-01', 'mage-01'],
    // Ordem de turnos decidida por d20 no início da partida.
    initiative: 'roll',
  },
};

export const maps: MapDefinition[] = [patioDasRuinas];
