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
  screens/arenaScreen.ts     monta cena + câmera + HUD + partida a partir de buildScenario()
  screens/hud.ts             HUD HTML (vez e recursos, seleção + ações sobre o alvo, encerrar turno,
                             avisos, iniciativa, aviso do modo de habilidade, fim de partida, ajuda)
  screens/actionBar.ts       barra de ações do personagem da vez (listUnitActions), atalhos 1–9, tooltip
  game/MatchController.ts    estado oficial da partida; aplica comandos pelo core (applyCommand)
  game/TacticalInteraction.ts modo tático (cursor, seleção, MOVE por clique) e modo de habilidade (mira)
  rendering/picking.ts       raycast da tela → entidade ou célula lógica (x, y, floor)
  rendering/highlights.ts    camadas de destaque de células (thin instances por andar)
  rendering/eventPlayback.ts reprodução dos eventos aceitos (passos, d20, dados, dano/cura, câmera, VFX)
  rendering/anim.ts          tween/espera pelo relógio da cena + ritmo da reprodução (normal / rápido)
  rendering/unitAnimator.ts  animações falsas dos personagens (idle, golpe, tiro, conjuração, dano, morte…)
  rendering/fx/particles.ts  partículas procedurais em pool (fogo, faíscas, fumaça, cura, gelo, rastro)
  rendering/fx/stateFx.ts    efeitos persistentes do estado: superfícies, barreira, estados, objetos em chamas
  rendering/worldLabels.ts   rótulos HTML presos ao mundo (custo, mira, barras, números, dados)
  rendering/unitBars.ts      PV + barreira + estados sobre cada personagem
  rendering/vfx.ts           efeitos visuais por evento: animação do executor, projéteis, impactos,
                             explosão, cura (módulo de VFX, ver vfx.md)
  rendering/grid.ts          cellToWorld / worldToCell (convenção abaixo)
  rendering/ArenaView.ts     constrói e sincroniza a cena a partir do GameState (só leitura)
  rendering/terrain.ts       pisos, paredes, lajes, guarda-corpos, pilares, escadas
  rendering/objects.ts       objetos provisórios por defId, refletindo o estado (portas animadas, destroços)
  rendering/units.ts         personagens (GLB da classe) + anel da equipe; nós root → pose → model, tinta/lampejo/opacidade
  rendering/floorView.ts     andar visualizado: estruturas acima ficam translúcidas
  rendering/loaders.ts       configuração do meshopt + cache de modelos
  rendering/materials.ts     paleta provisória
  rendering/camera/          CameraController, CameraInput, CameraFocus, CameraBounds,
                             CameraTransitions, CameraOcclusion (TODO), CameraEventQueue (mínimo)
```

## Convenção de coordenadas

Cena em sistema destro (`scene.useRightHandedSystem = true`, igual ao glTF). 1 unidade = 1 m.

| Lógico | Mundo |
|---|---|
| `x` | X = x · 2 + 1 (centro da célula) |
| `y` | Z = y · 2 + 1 |
| `floor` | Y = floor · 4 (face superior do piso) |

A célula (x, y) ocupa X ∈ [2x, 2x + 2), Z ∈ [2y, 2y + 2). `worldToCell` faz o inverso (andar = altura arredondada para o andar mais próximo, ou forçado por parâmetro). Na orientação 0° a câmera fica em +Z olhando para −Z: a tela tem a mesma leitura do mapa 2D do Lab (x para a direita, linha 0 no topo).

## Partida local (etapa 2)

A tela cria a partida com `buildScenario(catalog, { ...patioDasRuinas.scenario, dice: 'random', seed, autoStart: false })` e envia `START_MATCH` pelo MatchController (assim o `INITIATIVE_ROLLED` chega à tela como evento): dados aleatórios (o padrão `average` é só para cenários de teste) e iniciativa por d20. A semente sai no console (`[arena] semente dos dados: …`); `http://127.0.0.1:5173/?seed=42` repete a mesma partida.

O `MatchController` guarda o `GameState` oficial e só o altera via `applyCommand` (regras normais, sem opções de debug). Comando aceito → os eventos são animados (`eventPlayback.ts`) → `ArenaView.sync(state)` → HUD. Comando recusado → aviso no topo da tela com a mensagem do core. Durante a animação novos comandos são ignorados e o HUD continua mostrando o estado anterior (`displayedState`).

| Controle | Função |
|---|---|
| Clique esquerdo num personagem | Seleciona (painel à direita) |
| Clique esquerdo numa célula/objeto | Mostra no painel; se o personagem selecionado é o da vez e a célula está ao alcance, envia `MOVE` |
| Cursor sobre célula alcançável | Prévia do caminho (azul) e custo total em PM |
| Enter / Espaço / botão "Encerrar turno" | `END_TURN` do personagem da vez; a câmera foca o próximo |
| Esc | Cancela a mira; sem mira, limpa a seleção |

**Picking (14.5).** `rendering/picking.ts` lança um raio da câmera e só considera malhas selecionáveis e visíveis com metadados de terreno (`{ terrain, floor }`, em `terrain.ts`) ou de entidade (`metadata.entityId`, procurado subindo pelos pais). Destaques, superfícies, grade e o disco da equipe são ignorados. Estruturas acima do andar visualizado são fantasmas sem picking (FloorView), então com o térreo visualizado o raio atravessa as plataformas. A célula vem de `worldToCell` no ponto atingido recuado 1 cm para dentro da malha; o andar vem dos metadados da malha (pisos/lajes são mesclados por andar) — nas paredes, pela altura (pilares sob as lajes). Escadas pertencem à célula de baixo.

**Destaques (14.8).** `CellHighlightLayer`: uma malha-base por andar com *thin instances* (uma por célula, cor por instância), registrada no FloorView. Camadas: alcance de movimento (verde, mais escuro quanto maior o custo; `reachableCells` com os PM atuais), caminho (azul; `findPath`), cursor (branco; vermelho se há personagem pronto para mover e a célula não é alcançável), seleção (amarelo).

**Movimento.** Os passos vêm dos eventos `UNIT_MOVED` em ordem (0,25 s por célula, pulinho e rotação para a direção do passo; escada: 0,5 s com arco e troca de andar no meio). `DAMAGE_APPLIED` mostra um número flutuante sobre o alvo (fogo/espinhos no caminho).

## Interface de combate (etapa 3)

Nada aqui decide regra: listas, alvos, áreas e chances vêm de funções do core (`listUnitActions`, `listActionsOnTarget`, `listTargetCells`, `previewArea`, `previewTargets`) e todo número mostrado na reprodução vem de um evento.

| Controle | Função |
|---|---|
| 1–9 / clique numa carta | Ação da barra. Sem alvo (Defender, Barreira arcana, poções, Encerrar turno): executa na hora. Com alvo: entra no modo de habilidade. "Mover": volta ao modo tático |
| Clique esquerdo (modo de habilidade) | Confirma o alvo: `BASIC_ATTACK` / `USE_ABILITY` / `USE_ITEM`. Clicando num personagem/objeto o alvo é a entidade (se o motor aceita), senão a célula. Célula vermelha: o core recusa e o aviso mostra o motivo |
| Esc / clique direito sem arrastar | Cancela a mira (volta ao modo tático) |
| Clique num objeto/personagem (modo tático) | Painel à direita com as ações do personagem da vez sobre ele (`listActionsOnTarget`: "Abrir porta", "Acionar alavanca", "Abrir baú", ataques…), com botões; indisponíveis mostram o motivo |
| Passar o mouse numa carta | Tooltip com o mesmo texto do Lab (`describeDefinition` / `BASIC_ACTION_DESCRIPTIONS`) |

**Barra de ações.** Parte de baixo da tela: uma carta por ação do personagem da vez (tipo, nome, custo, atalho, "escolha o alvo · N válidos" ou o motivo da indisponibilidade). Só é recalculada quando o estado exibido muda (o `listUnitActions` sonda o motor).

**Modo de habilidade (14.8–14.9).** Ao escolher uma ação com alvo, `listTargetCells` sonda `applyCommand` em cada célula de chão no alcance: verde = válida, vermelho escuro = inválida (o cursor mostra o motivo do motor, ex.: "Sem linha de visão"). Os destaques de movimento somem; a câmera continua livre. Com o cursor numa célula válida: área afetada em amarelo (`previewArea`: cruz para Espinheiro/Frasco de óleo, a célula nos demais) e um rótulo com cada alvo da área (`previewTargets`): personagem com jogada de ataque → "chance de acerto 60% (d20 + 5 vs Def 14)" (`attackHitChance`: d20 + bônus ≥ Defesa, 1 natural erra, 20 acerta → 5%–95%); objetos e demais ocupantes → "acerto automático". Um aviso acima da barra lembra o modo e como cancelar.

**Dados na tela.** Durante a reprodução: `ATTACK_ROLLED` → selo do d20 sobre o alvo ("17 + 5 = 22 vs Def 14 — ACERTO / ERRO / ERRO (1 natural) / CRÍTICO!"), e "ERROU" no erro; `DICE_ROLLED` → fórmula e dados ("2d6+10: [3,6]+10 = 19", "crítico ·" com dados em dobro); números flutuantes: dano (vermelho), cura (verde), barreira absorvida/concedida (azul), estados (lilás), dano e destruição de objetos. Pausas curtas de leitura entre o d20, os dados e o número. No início da partida, painel com o d20 de iniciativa de cada personagem e a ordem.

**Barras sobre os personagens.** `UnitStatusBars`: nome (classe), PV com a barreira como extensão azul, números e estados com a duração restante; seguem o modelo durante a animação e caem junto com o número de dano (`patch` pelos eventos). Sem névoa ainda: todos aparecem.

**Câmera automática mínima (14.10–14.12).** A reprodução pede tomadas à `CameraEventQueue`: acompanha o personagem a cada passo, foca o alvo de ataques/habilidades/itens, explosões e derrotas, e volta ao executor no fim. Qualquer entrada manual (WASD, Q/E, scroll, arrastar, clique, Esc) interrompe até a próxima reprodução. Preferência `high` / `reduced` / `off` já existe na fila (sem tela de opções ainda).

## Efeitos e animações (etapa 4)

Detalhes, tabela evento → efeito e custos em [vfx.md](vfx.md). Resumo:

- **Ação:** animação do executor pelo `presentation.animationId` (golpe, tiro, conjuração à frente/sobre si) → projétil voando do executor ao alvo (0,3–0,55 s, com halo e rastro) → selo do d20 → impacto na cor do tipo de dano + recuo e lampejo vermelho de quem foi atingido → reações (explosão, superfícies). Ataque típico ≈ 1,5–2 s.
- **Cores:** os GLBs do manifesto usam material sem luz na cor exata do manifesto (antes o PBR com emissão × 1,6 estourava para amarelo/branco).
- **Explosão do barril:** bola de fogo, onda de choque até a borda das `cells`, células acesas, faíscas, fumaça, tremor leve da câmera e destroços (aduelas, aros, fuligem) que ficam no chão.
- **Superfícies persistentes:** óleo = poça escura brilhante; fogo = chamas por célula (partículas em pool) + brasa cintilando; espinhos = GLB `surface.thorns` por célula. Criadas/removidas pelos eventos e reconciliadas no `sync`.
- **Estados:** barreira = bolha arcana enquanto houver barreira (pulsa ao absorver, abre ao acabar); enraizado = raízes nos pés; em chamas = chamas no corpo; lentidão = tinta azul + flocos; oculto = translúcido com tinta lilás e cintilação (sem névoa ainda: todos veem).
- **Objetos:** destroços para barril/caixote/porta; objetos em chamas ganham fogo; porta, tampa do baú, alavanca e grade se movem.
- **Ritmo:** tecla **T** ou botão "Normal ▸ / Rápido ▸▸" acima de "Encerrar turno" (metade das durações; guardado no navegador). A fila de câmera continua igual; ataques a até 8 células enquadram o ponto médio entre executor e alvo.
- **Depuração:** `?units=druid@4,12;warrior@8,12` troca classe/posição dos personagens do cenário de exemplo (para ver Druida e Ladino); `window.__pace.speed = 0.25` desacelera as animações para capturas.

**Fim de partida.** `MATCH_ENDED` → tela com vitória/empate, motivo, PV finais e "Nova partida" (recarrega com uma semente nova).

## Controles da câmera

| Controle | Função |
|---|---|
| WASD / setas | Mover a câmera (relativo à tela) |
| Q / E | Girar 90° (0°, 90°, 180°, 270°) |
| Scroll | Zoom (10–60 m) |
| Botão do meio / direito + arrastar | Mover a câmera |
| F | Focar o personagem ativo |
| PageUp / PageDown | Andar visualizado (térreo / plataformas) — as teclas 1–9 agora são da barra de ações |
| H | Mostrar/ocultar a tabela de controles |
| T | Ritmo das animações: normal / rápido |
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

### Etapa 2 — Seleção, destaques, movimento e turnos

- [x] Partida com dados aleatórios e semente nova (`?seed=N` para repetir)
- [x] `MatchController`: estado oficial, `applyCommand` sem debug, últimos eventos, ouvintes; aviso no HUD para comando recusado
- [x] Picking por raycast: entidade (`metadata.entityId`) ou célula (`worldToCell` + andar da malha); ignora fantasmas e overlays
- [x] Cursor sobre a célula (respeita o andar visualizado) e painel de seleção (célula, objeto, personagem)
- [x] Destaques em thin instances por andar, integrados ao FloorView: alcance de movimento e prévia do caminho com custo em PM
- [x] `MOVE` por clique com animação célula a célula (eventos `UNIT_MOVED`), escadas com arco, número flutuante de dano
- [x] Encerrar turno (botão, Enter/Espaço) com foco da câmera no próximo personagem; PV/PA/PM/Foco do personagem da vez no HUD
- [x] Clique manual chama `CameraEventQueue.interrupt()`
- Capturas: [`screenshots/fase-02/passo-2/`](screenshots/fase-02/passo-2/)

### Etapa 3 — Interface de combate

- [x] Core: `listTargetCells` / `listValidTargets` (sondando `applyCommand`), `previewArea`, `previewTargets`, `attackHitChance`, `targetedCommand` — testes em `tests/unit/targets.test.ts`
- [x] Barra de ações com cartas disponíveis/indisponíveis (motivo), custo, tooltip do Lab e atalhos 1–9 (andar visualizado só em PgUp/PgDn)
- [x] Ações sem alvo executam na hora (Defender, Barreira arcana, poções, Encerrar turno)
- [x] Modo de habilidade: válidas (verde), inválidas no alcance (vermelho, com motivo), área (amarelo), chance de acerto / acerto automático; confirmar com clique, cancelar com Esc / clique direito
- [x] Ações sobre o alvo inspecionado no painel (`listActionsOnTarget`): portas, alavanca, baús, ataques
- [x] Dados na tela: d20 (acerto/erro/crítico), fórmula e dados do dano/cura, números de dano/cura/barreira, "ERROU", objetos
- [x] Iniciativa no início da partida (painel com os d20 e a ordem)
- [x] Barras de PV/barreira/estados sobre os personagens
- [x] Câmera acompanha o movimento, foca o alvo do ataque e volta (CameraEventQueue mínima, interrompível)
- [x] Tela de fim de partida com "Nova partida"
- [x] Correções da etapa 2: personagem na célula de escada fica sobre os degraus (`standingPoint`); dano em objetos com número flutuante; óleo não cobre mais os destaques
- Capturas: [`screenshots/fase-02/passo-3/`](screenshots/fase-02/passo-3/)

### Etapa 4 — Efeitos, animações e ritmo

- [x] Cores dos GLBs de VFX corrigidas (material sem luz na cor do manifesto); GLBs pré-carregados com a cena
- [x] Projéteis (fogo, gelo, arcano, natureza, flecha, frasco de óleo em arco) do executor ao alvo, visíveis 0,3–0,55 s, com halo e rastro
- [x] Impactos por tipo de dano com faíscas na cor; recuo e lampejo vermelho no alvo
- [x] Explosão: bola de fogo, onda de choque sobre `cells`, faíscas, fumaça, tremor de câmera; destroços persistentes do barril/caixote/porta
- [x] Barreira arcana como bolha persistente sincronizada com `unit.shield` (pulso ao absorver, some no `SHIELD_EXPIRED` / barreira zerada)
- [x] Cura (partículas subindo + GLB + lampejo), poções de vida/foco
- [x] Estados: oculto (translúcido + tinta + cintilação), enraizado (raízes), em chamas (fogo no corpo), lentidão (tinta + flocos)
- [x] Superfícies persistentes: óleo (poça brilhante), fogo (partículas em pool + brasa), espinhos (GLB por célula); `SURFACE_CREATED/REMOVED/EXPIRED` + reconciliação no `sync`
- [x] Objetos em chamas com fogo; porta/baú/alavanca/grade animados
- [x] `UnitAnimator`: idle, melee, shoot, cast_forward, cast_self, hit, death, interact (walk = pulinho existente)
- [x] Ritmo: executor → projétil → d20 → impacto → reações; modo "rápido" (T / botão)
- Capturas: [`screenshots/fase-02/passo-4/`](screenshots/fase-02/passo-4/)
- Lacunas conhecidas: o projétil voa até o alvo mesmo quando o d20 erra (não desvia); ocultação é só translucidez para todos (a névoa/visão por equipe é de outra fase); personagens são estáticos, então as "animações" são deslocamentos/inclinações do modelo inteiro; partículas de fogo em andares fantasmas param de emitir em vez de ficarem translúcidas; mira em alvos atrás do muro central ainda depende da etapa 5 (oclusão).

### Próximas etapas

- [ ] Etapa 5 — Andares e oclusão da câmera (14.6–14.7): o muro central cobre alvos ao norte com a câmera a 0°; personagens/rótulos em andar fantasma
- [ ] Etapa 6 — Partida completa controlando os dois lados (critério de aprovação), preferência de câmera automática, tela de opções
