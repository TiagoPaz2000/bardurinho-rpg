# Fase 2 — Arena visual 3D mínima

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): conectar o core validado na Fase 1 a um cliente Babylon.js. **Critério de aprovação:** uma partida completa executada localmente no cliente 3D, controlando os dois lados.

## Como rodar

```bash
npm install
npm run web        # cliente 3D em http://127.0.0.1:5173
```

O cliente fica em `apps/web` (`@bardurinho/web`, Vite + TypeScript + `@babylonjs/core` / `@babylonjs/loaders`). A pasta `assets/` da raiz é servida na raiz do site (`/models/...`), como no Combat Debug Lab. O decodificador meshopt dos GLBs é servido localmente em `/vendor/meshopt_decoder.js` (copiado de `node_modules/meshoptimizer` pelo `vite.config.ts`), sem CDN.

## Estrutura

```text
apps/web/src/
  main.ts                    entrada; expõe window.__arena para depuração
  screens/arenaScreen.ts     monta cena + câmera + HUD a partir de buildScenario()
  screens/hud.ts             HUD HTML (mapa, rodada, vez, andar, câmera, ajuda)
  rendering/grid.ts          cellToWorld / worldToCell (convenção abaixo)
  rendering/ArenaView.ts     constrói e sincroniza a cena a partir do GameState (só leitura)
  rendering/terrain.ts       pisos, paredes, lajes, guarda-corpos, pilares, escadas
  rendering/objects.ts       objetos provisórios por defId, refletindo o estado
  rendering/units.ts         personagens (GLB da classe) + anel da equipe
  rendering/floorView.ts     andar visualizado: estruturas acima ficam translúcidas
  rendering/loaders.ts       configuração do meshopt + cache de modelos
  rendering/materials.ts     paleta provisória
  rendering/camera/          CameraController, CameraInput, CameraFocus, CameraBounds,
                             CameraTransitions, CameraOcclusion (TODO), CameraEventQueue (TODO)
```

## Convenção de coordenadas

Cena em sistema destro (`scene.useRightHandedSystem = true`, igual ao glTF). 1 unidade = 1 m.

| Lógico | Mundo |
|---|---|
| `x` | X = x · 2 + 1 (centro da célula) |
| `y` | Z = y · 2 + 1 |
| `floor` | Y = floor · 4 (face superior do piso) |

A célula (x, y) ocupa X ∈ [2x, 2x + 2), Z ∈ [2y, 2y + 2). `worldToCell` faz o inverso (andar = altura arredondada para o andar mais próximo, ou forçado por parâmetro). Na orientação 0° a câmera fica em +Z olhando para −Z: a tela tem a mesma leitura do mapa 2D do Lab (x para a direita, linha 0 no topo).

## Controles da câmera

| Controle | Função |
|---|---|
| WASD / setas | Mover a câmera (relativo à tela) |
| Q / E | Girar 90° (0°, 90°, 180°, 270°) |
| Scroll | Zoom (10–60 m) |
| Botão do meio / direito + arrastar | Mover a câmera |
| F | Focar o personagem ativo |
| PageUp / PageDown, 1 / 2 | Andar visualizado (térreo / plataformas) |
| G | Grade de debug |
| Home | Visão geral da arena |

## Progresso

### Etapa 1 — Cena 3D e câmera tática

- [x] App `apps/web` (Vite + Babylon.js), `npm run web` em 127.0.0.1:5173
- [x] Cena do Pátio das Ruínas construída a partir de `buildScenario(catalog, patioDasRuinas.scenario)`
- [x] Grid lógico invisível conectado ao mundo (`cellToWorld` / `worldToCell`), overlay de debug opcional
- [x] Pisos, áreas escuras, paredes, plataformas (andar 1), guarda-corpos, pilares e escadas
- [x] Objetos provisórios por `defId` refletindo o estado (porta aberta/fechada/destruída, portão, alavanca, baú, cisterna, altar)
- [x] Placa de base GLB sob os Altares de Foco (teste do pipeline glTF + meshopt local)
- [x] Personagens GLB por classe (escala 1,7) com anel da equipe (A azul, B vermelho)
- [x] Manchas de óleo como placas sobre o piso
- [x] Iluminação hemisférica + direcional com sombras suaves
- [x] Câmera tática: 45°, rotação em passos de 90°, zoom limitado, pan, limites da arena, foco no personagem ativo
- [x] Andar visualizado: geometria acima fica translúcida, sem sombra e sem picking
- [x] HUD mínimo
- [ ] Oclusão da câmera (14.7) — stub em `CameraOcclusion`
- [ ] Fila de eventos de câmera (14.10–14.13) — stub em `CameraEventQueue`

### Próximas etapas

- [ ] Etapa 2 — Raycast, seleção de célula/entidade, destaques, movimento visual
- [ ] Etapa 3 — Interface de combate, barras de recursos, alcance e área
- [ ] Fogo, animações básicas, oclusão da câmera
- [ ] Partida completa controlando os dois lados
