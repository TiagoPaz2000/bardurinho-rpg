# Fase 2 — Arena visual 3D mínima

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): conectar o core validado na Fase 1 a um cliente Babylon.js. **Critério de aprovação:** uma partida completa executada localmente no cliente 3D, controlando os dois lados — **atendido na etapa 6** (ver "Partida completa e opções").

## Como rodar

```bash
npm install
npm run web        # cliente 3D em http://127.0.0.1:5173
npm run e2e:partida   # (com o cliente rodando) partida completa por entrada real + capturas da etapa 6
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
  screens/optionsMenu.ts     tela de opções (Esc / botão): câmera automática, ritmo, sensibilidade, inverter, tremor
  screens/settings.ts        preferências do cliente guardadas no navegador (localStorage)
  game/matchSummary.ts       resumo da partida para a tela de resultado (só a partir dos eventos aceitos)
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
  rendering/floorView.ts     andar visualizado: estruturas acima ficam translúcidas; personagens/efeitos/rótulos
                             fantasmas com a mesma opacidade (GHOST_ENTITY_VISIBILITY)
  rendering/loaders.ts       configuração do meshopt + cache de modelos
  rendering/materials.ts     paleta provisória
  rendering/camera/          CameraController, CameraInput, CameraFocus, CameraBounds,
                             CameraTransitions, CameraOcclusion (+ occlusionMath), CameraEventQueue
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
| Esc | Cancela a mira; sem mira, abre/fecha a tela de opções (etapa 6) |
| Clique direito sem arrastar | Cancela a mira; sem mira, limpa a seleção (etapa 6; antes era o Esc) |

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
- **Depuração:** `?units=druid@4,12;warrior@8,12` troca classe/posição dos personagens do cenário de exemplo (para ver Druida e Ladino); `window.__pace.speed = 0.25` desacelera as animações para capturas. Etapa 5: posição com andar (`warrior@1,6,1`) e consumíveis (`mage@8,12+health_potion,oil_flask`; na URL o `+` pode virar espaço, os dois valem).

## Andares e oclusão da câmera (etapa 5)

**Oclusão (14.7).** `CameraOcclusion` testa, a 15 Hz, raios da câmera até os pontos que devem ficar à vista contra a caixa de cada oclusor (`occlusionMath.findOccluders`, teste de slabs sem Babylon, coberto por `tests/unit/camera.test.ts`). Oclusores: o terreno agora é mesclado por componente conexo — cada segmento de muro, pilar, laje (com o guarda-corpo da mesma plataforma) e escada é uma malha (`TerrainBuild.occluders`) — e objetos com mais de 1,3 m (porta, portão, cisterna, altar; caixas relidas a cada teste porque abrem/quebram). Alvos: personagens vivos visíveis (peito e cabeça), a célula sob o cursor, as células válidas da mira e, durante a reprodução, as entidades e células envolvidas (`Spotlight` preenchido pelo `eventPlayback`: executor, alvo do d20, dano, cura, célula do alvo, centro da explosão). O oclusor atingido vai a 20 % de opacidade com fade amortecido (~0,3 s) e volta a 1 quando deixa de cobrir; esmaecido não é selecionável (o clique atravessa para o alvo). Compõe com o FloorView: visibilidade = min(fator do andar, fade), reaplicada quando o andar visualizado muda (`FloorView.version`). Um alvo dentro de uma estrutura (a porta mirada, o batente) não a esmaece; o fim do raio é encurtado 35 cm para o piso sob os pés não contar. Só cliente: colisão, linha de visão, cobertura e alcance continuam do core. Caso corrigido: com a câmera a 0°, o muro central escondia quem está logo ao norte dele — agora o segmento entre o portão e a porta fica translúcido (capturas 01–03). Custo: dezenas de oclusores × até ~90 pontos (mira) por teste, só aritmética.

**Andares (14.6).**

- Fantasma consistente: personagem acima do andar visualizado fica a 35 % (`GHOST_ENTITY_VISIBILITY`) no corpo, anel/disco, raízes, bolha da barreira, brilho das mãos, partículas de estado, barra de PV e rótulos flutuantes (classe `ghost` nos rótulos HTML, por `WorldLabels.ghostAt`: dono pelo ponto, senão o andar pela altura). Estruturas continuam a 12 %. Superfícies num andar fantasma também ficam a 35 %.
- Os materiais glTF dos personagens são opacos (`transparencyMode = OPAQUE`) e o Babylon ignorava `visibility` neles — personagem "translúcido" (fantasma, oculto, derrota) saía opaco. Agora cada personagem clona seus materiais e passa para ALPHABLEND com pré-passo de profundidade enquanto a opacidade < 1.
- Fogo/partículas num andar fantasma continuam emitindo, translúcidos (`ParticleHandle.setOpacity` escala o alfa dos gradientes), em vez de parar.
- Andar visualizado = max(andar escolhido, andar do personagem da vez). O escolhido começa no mais alto (tudo sólido) e muda só com PgUp/PgDn (escolha manual respeitada: PgDn com o personagem no alto deixa-o fantasma de propósito). É reaplicado no início de cada turno, no meio do passo de escada do personagem da vez (sobe com ele acima do escolhido; ao descer, volta ao escolhido) e ao sair da mira. Ao entrar na mira com alvos válidos num andar acima, a visualização sobe (eles ficariam fantasmas e sem picking).

**Fila de câmera (14.10–14.13).** `CameraEventQueue` agora tem relógio próprio (`update(dt)` no ritmo da reprodução): cada tomada segura a câmera por `durationHint`; tomadas de prioridade menor ficam adiadas (só a mais recente) e rodam quando a atual termina — a explosão (prioridade 2, 1,4 s, `radius` que abre o enquadramento sobre as células atingidas) não é cortada pelo retorno ao executor, que vem depois com `radius: 'restore'` (zoom de antes da reprodução). Preferências: `high` tudo; `reduced` só prioridade ≥ 2 (sem passos/projéteis/ataques simples) e o retorno só se a câmera saiu; `off` nada, exceto tomadas `essential`. Interrupção manual (WASD, Q/E, scroll, arrastar, clique, Esc): a câmera para onde está (`CameraController.settle`; a entrada agora chama a interrupção antes de se aplicar) e descarta adiadas/futuras interrompíveis até a próxima reprodução.

**Erro no d20.** Antes de animar `ATTACK_PERFORMED` / `ABILITY_USED` / `ITEM_USED`, a reprodução olha os eventos seguintes até a próxima ação (`actionHint`); se todas as jogadas de ataque erraram, o projétil desvia ~1,5 m para o lado do alvo, segue ~4 m além e some (capturas 07–09); golpe corpo a corpo não mostra o corte no alvo; o alvo faz a animação `dodge` (passo lateral).

**Fim de partida.** `MATCH_ENDED` → tela com vitória/empate, motivo, PV finais e "Nova partida" (recarrega com uma semente nova). Etapa 6: resumo, "Reiniciar" e "Ver a arena" (abaixo).

## Partida completa e opções (etapa 6)

**Critério de aprovação da fase.** `tools/e2e/partida-ui.mjs` (`npm run e2e:partida`, com o cliente rodando) abre o cliente num Chrome headless e joga uma partida inteira do Pátio das Ruínas (Guerreiro A × Mago B, `?seed=7`) **só com entrada real**: cliques do mouse nas células do canvas, nas cartas da barra, no painel do alvo e nos botões; atalhos 1–9, Enter, Esc; arrasto com o botão do meio para trazer a célula à tela. O `window.__arena` é só **lido** (estado, células alcançáveis, ponto da tela de uma célula) para o roteiro decidir a jogada; antes de cada clique ele confere que o picking acha a célula pretendida. Única ajuda de depuração: `__pace.speed = 3` para encurtar as animações (o ritmo "Rápido" é escolhido na própria tela de opções). Execução registrada (seed 7): 9 rodadas, 18 turnos, 49 comandos, vitória da equipe B por eliminação, **nenhum erro/aviso no console**, ~85 s. O roteiro sai com erro se algum item obrigatório faltar ou se houver erro no console.

| Momento | Como (entrada) | Captura |
|---|---|---|
| Opções: câmera automática Reduzida → Alta, ritmo Rápido, tremor liga/desliga; recarregar e conferir que persistiu | Esc, cliques nos botões | 01 |
| Mover (todos os turnos) | clique numa célula verde | — |
| Acender o óleo: Chama concentrada em (11,11) → fogo | atalho da carta + clique na célula | 02, 03 |
| Detonar o barril (10,10) com a Varinha arcana → explosão | clique na carta + clique no barril | 04a/b |
| Destruir obstáculo: Espada no caixote (6,3) | atalho + clique | 05 |
| Linha de visão: mira da Chama, cursor numa célula atrás do muro → "Sem linha de visão"; Esc cancela a mira (e não abre as opções) | atalho, mouse, Esc | 06 |
| Barreira arcana (sem alvo) | atalho | — |
| Subir a escada (0,3) → (0,4, andar 1) e descer | clique na plataforma / no térreo | 07, 08 |
| Célula logo atrás da porta (2,6), câmera a 0° | cursor: a porta esmaece e a célula fica clicável | 09 |
| Abrir a porta (2,7) | clique na porta → botão "Abrir porta" do painel | 10 |
| Investida, Espada, Empurrão (Guerreiro); Chama, Raio de geada, Varinha (Mago) no adversário | atalhos/cartas + clique | 11 |
| Encerrar turno | Enter e botão "Encerrar turno", alternados | — |
| Vitória → resultado; "Ver a arena" → "Resultado da partida" → "Reiniciar" (mesma semente, rodada 1) | cliques | 12, 13, 14 |

Capturas: [`screenshots/fase-02/passo-6/`](screenshots/fase-02/passo-6/). O roteiro é adaptativo (vai para a célula alcançável mais próxima do objetivo, ataca quando o alvo é válido, gira a câmera com E se a célula estiver encoberta), então outras sementes também devem chegar ao fim, mas só a 7 foi registrada.

**Tela de resultado.** Vencedor (ou empate) e motivo, rodadas, turnos, comandos e uma tabela por personagem: estado final, dano causado em personagens (pela `cause.sourceId` do evento — inclui explosões/fogo que ele disparou), dano recebido, acertos/jogadas de d20, cura e objetos destruídos (`game/matchSummary.ts`, só eventos aceitos, guardados em `MatchController.history`; teste em `tests/unit/match-summary.test.ts`). Botões: **Jogar novamente** (semente nova), **Reiniciar** (mesma semente) e **Ver a arena** (fecha; o botão "Resultado da partida" acima de "Encerrar turno" reabre). Reiniciar/jogar novamente recarregam a página com `?seed=` (o jeito mais simples e garantido de reconstruir cena e estado do zero; mantém `?units=`).

**Tela de opções** (Esc sem mira ativa, ou botão "Opções"; Esc, "Voltar ao jogo" ou clique fora fecham). Enquanto aberta, a partida não recebe teclas, cliques, scroll nem arrasto, e a mira é cancelada.

| Opção | Efeito |
|---|---|
| Câmera automática: Alta / Reduzida / Desativada | `CameraEventQueue.preference` (`high` / `reduced` / `off`, regras da etapa 5); Desativada também desliga o tremor |
| Ritmo das animações: Normal / Rápido | o mesmo da tecla T e do botão do HUD (`bardurinho.pace`) |
| Sensibilidade da câmera 0,5×–2× | multiplica o pan por teclado/arrasto e o passo do zoom |
| Inverter arrasto da câmera | arrastar move a câmera no sentido do mouse em vez de "agarrar" o chão |
| Inverter zoom (scroll) | scroll para cima afasta |
| Tremor da câmera nas explosões | liga/desliga o `camera.shake` |
| Reiniciar partida / Nova partida | mesma semente / semente nova |

Guardadas em `localStorage` (`bardurinho.settings`, validadas por `normalizeSettings`; o ritmo continua em `bardurinho.pace`).

**Correções descobertas pela partida roteirizada.**

- *Célula logo atrás de uma porta não era selecionável.* Com a câmera a 0°, a porta (2,7) cobre a célula (2,6) na tela; o raio do cursor batia na porta, e a oclusão só esmaecia o que cobria a célula *já* sob o cursor (ovo e galinha). Agora o cursor também calcula a célula de chão sob ele ignorando estruturas (raio × plano do andar visualizado e dos de baixo, `TacticalInteraction.pointerFloorCell`), e ela entra nos alvos da oclusão: o que estiver na frente esmaece (e deixa de ser selecionável), e a célula atrás fica clicável (captura 09). Vale também para muros; a lacuna da etapa 5 "passar o cursor logo acima do muro pode esmaecê-lo" passa a ser o comportamento esperado.
- Consequência: com a porta esmaecida o clique chega ao piso da célula da porta — clique no piso de uma célula com objeto agora inspeciona o objeto (painel com "Abrir/Fechar porta", ataques…).
- A carta "Mover" volta a selecionar o personagem da vez: depois de inspecionar a porta ou o adversário, os cliques em células voltam a mover.
- Rótulos do mundo (barras de PV) apareciam por cima da tela de resultado; agora ela fica acima.

## Controles da câmera

| Controle | Função |
|---|---|
| WASD / setas | Mover a câmera (relativo à tela) |
| Q / E | Girar 90° (0°, 90°, 180°, 270°) |
| Scroll | Zoom (10–60 m) |
| Botão do meio / direito + arrastar | Mover a câmera |
| F | Focar o personagem ativo |
| PageUp / PageDown | Andar escolhido (térreo / plataformas); o visualizado sobe junto quando o personagem da vez está acima — as teclas 1–9 são da barra de ações |
| H | Mostrar/ocultar a tabela de controles |
| Esc / botão "Opções" | Tela de opções (sem mira ativa) |
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
- [x] Oclusão da câmera (14.7) — `CameraOcclusion` (etapa 5)
- [x] Fila de eventos de câmera (14.10–14.13) — `CameraEventQueue` com prioridade, duração, enquadramento e preferência (etapa 5; a tela de opções para escolher a preferência é da etapa 6)

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
- Lacunas conhecidas (as marcadas ✔ foram resolvidas na etapa 5): ✔ o projétil voa até o alvo mesmo quando o d20 erra (não desvia); ocultação é só translucidez para todos (a névoa/visão por equipe é de outra fase); personagens são estáticos, então as "animações" são deslocamentos/inclinações do modelo inteiro; ✔ partículas de fogo em andares fantasmas param de emitir em vez de ficarem translúcidas; ✔ mira em alvos atrás do muro central ainda depende da etapa 5 (oclusão); ✔ (descoberto na etapa 5) personagens "translúcidos" (oculto, derrota) saíam opacos porque os materiais glTF são opacos.

### Etapa 5 — Andares e oclusão da câmera

- [x] Terreno mesclado por componente (segmentos de muro, pilares, lajes + guarda-corpo, escadas) com lista de oclusores; picking inalterado
- [x] `CameraOcclusion`: raios câmera → alvos (personagens, cursor, células válidas da mira, envolvidos na reprodução) a 15 Hz; fade suave para 20 % e volta; sem picking quando esmaecido; compõe com o andar visualizado
- [x] Caso do muro central a 0° corrigido (antes/depois nas capturas 01–02; mira na 03)
- [x] Objetos altos (porta, portão, cisterna, altar) como oclusores dinâmicos; o próprio alvo nunca é esmaecido
- [x] Fantasma consistente: corpo, anel/disco, raízes, barreira, brilho das mãos, partículas de estado, barra e rótulos com a mesma opacidade (35 %); superfícies no andar fantasma a 35 %
- [x] Corpo do personagem respeita a opacidade (materiais glTF opacos → ALPHABLEND + pré-passo de profundidade enquanto < 1) — vale também para oculto e derrota
- [x] Fogo/partículas em andar fantasma continuam emitindo, translúcidos
- [x] Andar visualizado acompanha o personagem da vez (turno, escada, mira), respeitando o andar escolhido com PgUp/PgDn
- [x] Projétil desvia e passa direto no erro do d20; golpe sem corte; alvo se esquiva (`dodge`)
- [x] `CameraEventQueue`: duração/prioridade com tomada adiada, abertura do enquadramento na explosão, retorno com zoom restaurado, `reduced`/`off`/`essential`, interrupção que para a câmera onde está — testes em `tests/unit/camera.test.ts`
- [x] `?units=` com andar e consumíveis (depuração das capturas de poção e frasco)
- [x] Capturas: oclusão a 0° (antes/depois, mira), andar fantasma (personagem + fogo), escada, projétil errando, poção de vida, frasco de óleo em arco, porta abrindo — [`screenshots/fase-02/passo-5/`](screenshots/fase-02/passo-5/)
- [x] Tela de opções para a preferência de câmera automática (etapa 6)
- Lacunas conhecidas: a oclusão é translucidez (20 %), não recorte — a estrutura esmaecida ainda projeta sombra; passar o cursor logo acima do muro pode esmaecê-lo (o centro da célula sob o cursor está atrás dele); barris e caixotes (< 1,3 m) nunca esmaecem; o erro é decidido por ação (todas as jogadas erraram) — numa área com acertos e erros mistos o projétil vai ao alvo; o desvio do projétil não testa paredes (pode atravessar o muro ao passar direto); o fogo no andar fantasma da captura 05 foi criado só na cena (`stateFx.setSurface`, sem regra) para conferir a emissão; o foco no início da partida/turno não passa pela fila (é direto, por isso vale mesmo com `off`).

### Etapa 6 — Partida completa, resultado e opções

- [x] **Critério de aprovação da Fase 2:** partida completa no cliente 3D, controlando os dois lados até a vitória, só por entrada real (`tools/e2e/partida-ui.mjs`, seed 7: 9 rodadas, vitória da equipe B, sem erros no console) — mover, subir/descer escada, abrir porta, habilidades das duas classes, acender óleo, detonar barril, destruir caixote, linha de visão, fim com tela de resultado e reiniciar
- [x] Tela de resultado: vencedor, motivo, rodadas/turnos/comandos, tabela por personagem (dano causado/recebido, acertos, cura, objetos); Jogar novamente / Reiniciar / Ver a arena
- [x] Tela de opções (Esc / botão): câmera automática Alta/Reduzida/Desativada, ritmo, sensibilidade, inverter arrasto/zoom, tremor; guardadas no navegador; partida bloqueada enquanto aberta
- [x] Cursor sobre o chão atrás de porta/muro esmaece o oclusor e a célula fica clicável; clique no piso de célula com objeto inspeciona o objeto; "Mover" reseleciona o personagem da vez; resultado acima dos rótulos
- [x] Testes: `tests/unit/match-summary.test.ts` (resumo e normalização das preferências)
- [x] Capturas: [`screenshots/fase-02/passo-6/`](screenshots/fase-02/passo-6/)
- Decisões: Esc sem mira abre as opções (limpar a seleção passou para o clique direito); reiniciar = recarregar a página com `?seed=` (mesma ou nova); a sensibilidade vale para pan e zoom (a rotação é em passos de 90°); sem tela de título/menu inicial — a partida começa ao abrir a página.
- Lacunas conhecidas: a partida registrada usa uma semente (7) e o duelo 1 × 1 do cenário do mapa — só Guerreiro e Mago jogaram uma partida inteira (Ladino e Druida foram vistos nas etapas 3–5 via `?units=`); consumíveis, baú, alavanca/portão, cisterna e altar não entraram na partida roteirizada (cobertos pelos testes do core e pelas capturas das etapas anteriores); a câmera automática jogou em "Alta" (Reduzida/Desativada só foram escolhidas na tela; o comportamento delas é coberto por `tests/unit/camera.test.ts`); o esmaecimento pelo chão sob o cursor também esmaece um muro quando o cursor só passa por cima dele; rótulos de eventos simultâneos podem se sobrepor (ex.: "Barril explodiu" e "destruído", captura 04a); ocultação/névoa por equipe continuam para a Fase 3 (os dois lados no mesmo cliente veem tudo).

### Próximas etapas

- [x] Etapa 5 — Andares e oclusão da câmera (14.6–14.7)
- [x] Etapa 6 — Partida completa controlando os dois lados (critério de aprovação), preferência de câmera automática, tela de opções
- Fase 2 concluída. Próxima: Fase 3 — multiplayer local (servidor autoritativo, visão individual).
