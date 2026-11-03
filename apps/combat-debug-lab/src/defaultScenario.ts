import type { ScenarioInitial } from '@bardurinho/domain';

/** Cenário inicial do laboratório: pátio pequeno com óleo, barris, porta e bonecos. */
export const defaultScenario: ScenarioInitial = {
  name: 'Laboratório — pátio de testes',
  map: {
    floors: [
      [
        '............',
        '............',
        '....#####...',
        '....#ddd#...',
        '....#ddd....',
        '....##.##...',
        '............',
        '............',
        '............',
        '............',
      ],
    ],
  },
  units: [
    { id: 'mage-01', classId: 'mage', team: 'A', pos: { x: 1, y: 7 }, consumables: ['consumable.oil_flask', 'consumable.health_potion'] },
    { id: 'warrior-01', classId: 'warrior', team: 'B', pos: { x: 10, y: 7 } },
    { id: 'dummy-01', type: 'debug.test-dummy', preset: 'dummy.default', pos: { x: 4, y: 8 } },
    { id: 'dummy-02', type: 'debug.test-dummy', preset: 'dummy.armored', pos: { x: 6, y: 8 } },
    { id: 'dummy-03', type: 'debug.test-dummy', preset: 'dummy.fire_resistant', pos: { x: 8, y: 8 } },
  ],
  objects: [
    { id: 'door-01', defId: 'door', pos: { x: 6, y: 5 } },
    { id: 'barrel-01', defId: 'barrel', pos: { x: 3, y: 1 } },
    { id: 'barrel-02', defId: 'barrel', pos: { x: 9, y: 1 } },
    { id: 'crate-01', defId: 'crate', pos: { x: 8, y: 6 } },
    { id: 'chest-01', defId: 'chest', pos: { x: 6, y: 3 } },
  ],
  surfaces: [
    { cells: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }], surface: 'oil' },
    { cells: [{ x: 9, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 3 }], surface: 'oil' },
  ],
  order: ['mage-01', 'warrior-01', 'dummy-01', 'dummy-02', 'dummy-03'],
  autoStart: false,
};
