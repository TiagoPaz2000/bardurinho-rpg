# Fase 4 — Conteúdo completo do MVP

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): implementar todo o conteúdo da primeira versão. **Critério de aprovação:** todo o conteúdo do MVP com comportamento verificável no Combat Debug Lab **e** no cliente 3D — **atendido** (ver "Critério de aprovação"), com as lacunas listadas no fim (modelos/animações definitivos e ícones de recursos).

A auditoria mostrou que o núcleo de regras e o catálogo da Fase 1 já cobriam as 4 classes, 10 habilidades, 14 itens, estados, superfícies, reações e objetos. O trabalho desta fase foi: **provar** cada peça (cenários + testes), corrigir o que a prova revelou, e levar todo o conteúdo para o cliente 3D e para o modo em rede (escolha de classes, ícones, VFX/SFX, feedback, recargas).

## Como verificar

```bash
npm install
npx tsc -b                 # tipos
npx vitest run             # 260 testes: unidade, 93 cenários JSON, integração do servidor
npm run lab                # http://127.0.0.1:5174 — lateral "Cenários de teste (93)"
npm run web                # http://127.0.0.1:5173 — tela de escolha de personagens
npm run server             # rede: http://127.0.0.1:5173/?mode=rede (lobby com escolha 1×1 / 2×2)
npm run e2e:conteudo       # (com web + lab rodando) critério de aprovação; capturas em docs/screenshots/fase-04/
npm run e2e:partida        # (com web) Fase 2 — continua passando
npm run e2e:rede           # Fase 3 — continua passando
npm run icons:svg && npm run icons:sheet   # regenera os ícones e a folha de contato
```

## O que foi feito

### Conteúdo e regras (domain + content)

- **93 cenários** em `tests/scenarios/<categoria>/<nome>/` (eram 5): `abilities/` (23), `items/` (16), `statuses/` (11), `objects/` (12), `reactions/` (8), `surfaces/` (7), `visibility/` (4), `cooldowns/` (3), `match/` (4), `combat/` (2), `movement/`, `explosions/`, `spells/`. Cada um tem `name`/`description` em português e `expected.json` preciso (PV, PA, Foco, posição, estados, barreira, objetos, células, lista de dano, subsequência de eventos, eventos proibidos).
- `tests/unit/content-coverage.test.ts`: falha (listando os ids) se alguma habilidade, item (14), estado, superfície, objeto ou classe do catálogo **não** aparecer em nenhum cenário — o "toda nova habilidade deverá possuir cenários" do plano virou teste.
- `tests/unit/content-limitations.test.ts`: código de erro exato de 33 cenários de limitação (o cenário só conta erros), custos/recargas/alcances contra o plano, armadura por classe, acessórios, regra dos dois consumíveis diferentes.
- **Correção:** a alavanca fechava o portão com um personagem na passagem (ficava dentro de uma célula bloqueada); agora é recusada com `CELL_OCCUPIED`, como a porta (`checks.ts` → `checkInteract`; teste + cenário `objects/gate_cannot_close_on_unit`).
- **Montagem da partida** (`packages/content/src/maps/setup.ts`): `MatchSetup` = equipes A e B com 1–2 personagens, cada um com classe, acessório e até 2 consumíveis de tipos diferentes (`normalizeChoice`/`normalizeTeam` validam); `scenarioFromSetup` põe os personagens nos pontos de início do mapa (`MapDefinition.spawns`: A (7,0),(6,0); B (8,15),(9,15), simétricos e sem linha de visão entre equipes — testado); `encodeSetup`/`decodeSetup` para a URL. Testes: `tests/unit/match-setup.test.ts`.
- `ActionInfo.cooldown` / `abilityCooldown()` (domain, só leitura): turnos próprios até a habilidade voltar e se já foi usada no turno — para a interface mostrar recargas sem repetir regra.

### Combat Debug Lab

- Lateral **"Cenários de teste (93)"**: os mesmos JSON de `tests/scenarios` (`import.meta.glob`). Ao escolher, a timeline recebe os comandos do cenário (STEP, REPLAY, inspeção, State Diff funcionam) e o resultado é conferido com o `expected.json` pela mesma função do vitest (`checkExpectations`): mensagem "✓ conforme o expected.json" ou a lista de divergências. `?scenario=<categoria>/<nome>` abre direto; `window.__lab.runAll()` confere todos no navegador (`apps/combat-debug-lab/src/scenarioLibrary.ts`). O Vite resolve o `glob` ao transformar o módulo: pastas de cenário criadas com o Lab já aberto só entram depois de reiniciar o `npm run lab` (ou salvar `scenarioLibrary.ts`).

### Cliente 3D

- **Escolha de personagens (local):** abrir `http://127.0.0.1:5173/` sem parâmetros mostra a tela de escolha: formato 1 × 1 / 2 × 2 e, por personagem, classe (com PV/PA/PM/Foco/armadura/defesa, armas e habilidades com ícones), acessório e consumíveis. "Começar partida" recarrega com `?setup=…&seed=…` (Reiniciar/Jogar novamente mantêm a escolha). Links com `?seed=`, `?setup=` ou `?units=` vão direto à partida (o `e2e:partida` continua no duelo fixo do mapa).
- **Rede:** o lobby tem o mesmo editor para a equipe do jogador (classe "Automática" = padrão da equipe do assento) e o formato da sala. O servidor recebe `teamSize` (quem cria; `filterBy(['teamSize'])` no matchmaking) e `team` (cada jogador), valida com `normalizeTeam`, remonta o estado inicial e **substitui o snapshot 0** (ainda versão 0, antes do `START_MATCH`; o replay parte dele); quem já estava na sala recebe um snapshot novo. Sem `teamSize` (clientes antigos, `e2e:rede`) a partida usa o cenário fixo como na Fase 3. Teste de integração: 2 × 2 com escolhas válidas e inválidas, cada cliente só com a própria equipe, replay ok.
- **Ícones** (41, [docs/icones.md](icones.md)): 36 SVG gerados por código (`tools/icons/svg.ts`) + as 5 armas PNG, agora com fundo transparente na versão web (`npm run icons`). Usados nas cartas da barra, na tela de escolha/lobby, nas barras sobre os personagens (estados com ícone e turnos restantes), no painel do personagem (estados, recargas, acessório e consumíveis, armadura e resistências) e nos rótulos flutuantes (estado terminou, item recebido).
- **Recargas:** carta com selo (ícone de recarga + turnos até voltar), "recarga N · usada" e o motivo; painel do personagem da vez lista as habilidades em recarga; rótulo "<habilidade>: recarga N" ao usar.
- **Feedback novo** (`eventPlayback.ts`): estado terminou/removido, Foco recuperado (poção e altar), item recebido do baú, reações ambientais ("Óleo em chamas!", "Fogo apagado (água)", "Barril detonado!"…), objeto em chamas, empurrão bloqueado, recarga iniciada.
- **VFX novos** (`vfx.ts`): água da cisterna (respingo por célula), frio na célula (cristais), altar de Foco (mesmo brilho da poção), baú (brilho dourado + frasco). Os demais já existiam (tabela em [vfx.md](vfx.md)) e foram todos exercitados no e2e.
- **SFX** (`rendering/sfx.ts`): ~45 sons sintetizados com WebAudio (sem arquivos), um por família — conjuração por elemento, arco, golpe, investida, empurrão, impactos por tipo de dano, bloqueio, erro, crítico, cura, Foco, barreira, estados, óleo, fogo, espinhos, raízes, ocultação, água, explosão, madeira quebrando, porta, alavanca, baú, turno, derrota, fim. `soundsForEvent` é pura e testada (`tests/unit/sfx.test.ts`: toda habilidade/arma/consumível tem som). **Volume** na tela de opções (0 = mudo, guardado em `bardurinho.settings.sfxVolume`). O contexto de áudio começa no primeiro clique/tecla.
- Depuração (só local): `?dice=average` usa os dados em "média fixa" dos cenários de teste (roteiros determinísticos); `?units=` mantém o id quando a classe não muda.

## Critério de aprovação

`npm run e2e:conteudo` (`tools/e2e/conteudo.ts` + `conteudo-casos.ts`), com web e lab rodando, Chrome headless (SwiftShader, `--autoplay-policy=no-user-gesture-required`):

1. **Lab:** `__lab.runAll()` confere os 93 cenários no navegador (0 divergências); três são abertos pela URL e capturados.
2. **Tela de escolha:** por cliques, 2 × 2 com as quatro classes, Amuleto da vitalidade e Medalhão da geada, consumíveis trocados → a partida começa com elas (PV 118, resistência a frio 2).
3. **Três partidas roteirizadas** (Mago × Guerreiro; Ladino × Druida; ambiente) — 69 jogadas **só por entrada real** (atalho ou clique na carta, clique na célula do canvas, clique no objeto + botão do painel, Enter). Antes de cada jogada o roteiro aplica o mesmo comando no core; depois da animação **o estado do cliente é idêntico (hash) ao do core** em todas. Também confere cartas indisponíveis com o motivo (Raio de geada em recarga, Mover enraizado) e o selo de recarga.
4. **Rede:** servidor próprio; duas abas escolhem 2 × 2 no lobby (Ladino + Guerreiro × Druida + Mago); a partida começa com eles e cada aba só vê a própria equipe.
5. **Cobertura conferida no fim:** 4/4 classes, 10/10 habilidades, 5/5 armas, 3/3 armaduras, 3/3 acessórios, 3/3 consumíveis, 5/5 estados (com Barreira), 3/3 superfícies, reações (calor+óleo, frio+Queimando, água+fogo, água+Queimando), objetos (barril explodindo, caixote danificado, porta aberta, alavanca + portão, baú, altar, cisterna); todos os ícones do HUD carregados; sons tocados (explosão, água, fogo, conjuração, porta, alavanca, Foco, turno) com o áudio rodando; volume alterado na tela de opções; **nenhum erro/aviso no console**.

Registro (seed 4, dados em média fixa): tudo conferido em ~3 min. Capturas em [`screenshots/fase-04/`](screenshots/fase-04/): `01-escolha-2x2`, `02-arena-2x2-quatro-classes`, `lab-0N-*`, `<caso>-<passo>-mira-*` (mira com área e chance) e `<caso>-<passo>-*` (meio da animação), `<caso>-fim`, `opcoes-volume`, `rede-0N-*`, `icones.png`, `icones-32px-zoom.png`.

`npm run e2e:partida` e `npm run e2e:rede` continuam passando (e `tests/integration/server.test.ts`).

## Tabela de lacunas (plano × implementação)

✅ implementado e verificado · ⚠️ implementado com ressalva · ❌ não implementado. "Lab" = cenário(s) em `tests/scenarios` (abríveis no Lab); "3D" = exercitado no `e2e:conteudo`.

### Classes

| Classe | Atributos (2.1) | Lab | 3D local | Rede | Status |
|---|---|---|---|---|---|
| Mago | 80 PV, 5 PM, 10 Foco, armadura 0 | `items/armor_tunic_mage` + habilidades | ✅ | ✅ | ✅ |
| Ladino | 90 PV, 6 PM, 8 Foco, armadura 2 | `items/armor_leather_rogue_druid` | ✅ | ✅ | ✅ |
| Guerreiro | 110 PV, 5 PM, 8 Foco, armadura 4 | `items/armor_reinforced_mail_warrior` | ✅ | ✅ | ✅ |
| Druida | 95 PV, 5 PM, 10 Foco, armadura 2 | `items/armor_leather_rogue_druid` | ✅ | ✅ | ✅ |

Modelos: um GLB por classe (`assets/models/characters`). ⚠️ sem esqueleto/animações reais (ver lacunas).

### Habilidades (seção 4)

| Habilidade | Custo / recarga | Lab | 3D | Status |
|---|---|---|---|---|
| Chama concentrada | 1 PA + 2 Foco / 0 | `abilities/mage_flame_burning_target`, `mage_flame_miss_still_heats`, `spells/…`, `cooldowns/recharge_0_once_per_turn` | ✅ Queimando, calor + óleo, barril | ✅ |
| Raio de geada | 1 PA + 2 / 1 | `abilities/mage_frost_ray_slows`, `reactions/frost_removes_fire_and_burning`, `cooldowns/recharge_1_frost_ray` | ✅ Lentidão, remove Queimando, recarga na barra | ✅ |
| Barreira arcana | 1 PA + 3 / 2 | `abilities/mage_arcane_barrier_lasts`, `_expires`, `cooldowns/recharge_2_arcane_barrier` | ✅ | ✅ |
| Tiro preciso | 1 PA + 3 / 1 | `abilities/rogue_precise_shot`, `_limits` | ✅ saindo de Oculto (+4) | ✅ |
| Ocultação | 1 PA + 2 / 2 | `abilities/rogue_hide_in_dark_area`, `_denied_in_sight`, `_out_of_sight_duration`, `statuses/hidden_*` | ✅ área escura | ✅ |
| Investida | 1 PA + 2 / 1 | `abilities/warrior_charge`, `_blocked_by_door`, `_blocked_by_unit`, `_dies_in_fire`, `_other_floor` | ✅ | ✅ |
| Empurrão | 1 PA + 2 / 1 | `abilities/warrior_push`, `_stops_at_wall`, `_no_fall_from_platform` | ✅ | ✅ |
| Espinheiro | 1 PA + 3 / 1 | `abilities/druid_thorns_cross`, `_incompatible_cells` | ✅ cruz sob o ladino | ⚠️ duração 3 rodadas é hipótese (plano não fixa) |
| Cura natural | 1 PA + 4 / 2 | `abilities/druid_natural_heal`, `_capped` | ✅ | ✅ |
| Enraizar | 1 PA + 3 / 2 | `abilities/druid_root`, `movement/rooted_blocks_move` | ✅ Mover bloqueado | ✅ |

### Itens (seção 3)

| Item | Lab | 3D | Status |
|---|---|---|---|
| Espada de ferro | `items/iron_sword_same_floor_only`, `combat/sword_vs_armor_and_barrier` | ✅ | ✅ |
| Adaga | `items/dagger_melee` | ✅ | ✅ |
| Arco curto | `items/short_bow_range` (não atira adjacente) | ✅ | ✅ |
| Varinha arcana | `items/arcane_wand` | ✅ (caixote, personagem) | ✅ |
| Cajado natural | `items/nature_staff` | ✅ | ✅ |
| Túnica / Armadura de couro / Cota reforçada | `items/armor_*` | ✅ (painel: armadura) | ✅ fixas por classe |
| Amuleto da vitalidade | `items/vitality_amulet` | ✅ escolhido na tela (+8 PV) | ✅ |
| Medalhão das cinzas | `items/ash_medallion` | ✅ | ✅ |
| Medalhão da geada | `items/frost_medallion` | ✅ (mitigação no Raio de geada) | ✅ |
| Poção de vida | `items/health_potion`, `_self_only_capped` | ✅ | ⚠️ alvo explícito em outro personagem é ignorado (cura a si), não recusado |
| Poção de Foco | `items/focus_potion` | ✅ | ✅ |
| Frasco de óleo | `items/oil_flask`, `_limits`, `reactions/oil_flask_on_fire` | ✅ cruz, depois incendiada | ⚠️ ver "óleo sobre fogo" |
| Dois consumíveis de tipos diferentes por personagem | `content-limitations.test.ts`, `match-setup.test.ts` | ✅ escolhidos na tela/lobby | ✅ (o cenário fixo do mapa, usado pelos e2e antigos, começa sem consumíveis) |

### Estados, superfícies, reações

| Conteúdo | Lab | 3D | Status |
|---|---|---|---|
| Queimando (4 fogo × 2 inícios, renova) | `statuses/burning_two_ticks`, `burning_refresh_no_stack` | ✅ | ✅ |
| Lentidão (−2 PM, não acumula) | `statuses/slowed_*` | ✅ | ✅ |
| Enraizado | `statuses/rooted_during_target_turn` | ✅ | ✅ |
| Barreira (não soma; mais fraca não prolonga) | `statuses/barrier_*`, `defend_once_per_turn` | ✅ Barreira arcana, Defender | ✅ |
| Oculto | `statuses/hidden_*`, `visibility/*` | ✅ | ✅ |
| Óleo (entrar 2 PM) | `surfaces/oil_enter_cost` | ✅ | ✅ |
| Fogo (6 ao entrar/iniciar; 1×/turno global) | `surfaces/thorns_and_fire_exposure`, `push_into_fire_once_per_turn`, `creation_under_unit_counts_as_exposure` | ✅ | ✅ |
| Espinhos (2 PM, 5 físico) | `surfaces/thorns_and_fire_exposure` | ✅ | ✅ |
| Expiração em R + N | `surfaces/expiry_r_plus_n` | ✅ (fogo expira no caso "ambiente") | ✅ |
| Calor + óleo (mancha conectada, mesmo andar) | `reactions/heat_oil_connected_same_floor`, `surfaces/oil_ignition` | ✅ | ✅ |
| Calor + espinhos | `reactions/heat_thorns` | — (Lab) | ✅ |
| Calor + madeira | `reactions/heat_wood_crate_combustion`, `objects/door_burns` | — (Lab) | ✅ |
| Fogo + barril | `reactions/oil_fire_detonates_barrel`, `explosions/barrel_chain` | ✅ | ✅ |
| Frio + fogo / Frio + Queimando | `reactions/frost_removes_fire_and_burning`, `frost_ray_miss_still_cools_cell` | ✅ | ⚠️ no erro do d20 o frio da célula ainda remove Queimando do alvo |
| Água + fogo / + Queimando / + madeira | `reactions/cistern_water` | ✅ cisterna | ✅ |
| Óleo lançado sobre fogo | `reactions/oil_flask_on_fire` | — (Lab) | ⚠️ só a célula em chamas reage; as 4 vizinhas recém-lançadas ficam óleo |
| Espinhos sobre óleo/fogo não substituem | `abilities/druid_thorns_incompatible_cells` | — (Lab) | ✅ |

### Objetos e mapa (seção 6)

| Objeto | Lab | 3D | Status |
|---|---|---|---|
| Barril (8 PV, explode, cadeia, limitado por paredes/andar) | `objects/barrel_*`, `explosions/barrel_chain`, `match/draw_mutual_destruction_explosion` | ✅ | ⚠️ diagonal some se uma quina for parede (3×3 pode virar 4 células) |
| Porta (abrir/fechar 1 PA, 30 PV, queima) | `objects/door_open_close`, `door_destructible`, `door_burns`, `door_occupied_cannot_close` | ✅ abrir | ✅ |
| Portão + alavanca | `objects/gate_and_lever`, `gate_cannot_close_on_unit` | ✅ | ✅ (corrigido nesta fase) |
| Caixa (20 PV, bloqueia, queima) | `objects/crate_blocks_and_breaks`, `visibility/crate_blocks_vision` | ✅ dano | ✅ |
| Cisterna (1 uso, cruz) | `reactions/cistern_water` | ✅ | ✅ |
| Baú (poção, precisa de espaço) | `objects/chest_grants_potion`, `chest_needs_inventory_space` | ✅ | ✅ |
| Altar de Foco (1 uso) | `objects/focus_altar` | ✅ | ✅ |
| Áreas escuras / luz do fogo | `visibility/dark_area_detection_range`, `fire_lights_dark_area` | ✅ Ocultação na alcova | ✅ |
| Vitória, desistência, empate (morte simultânea, 20 rodadas) | `match/*` | Fase 2 e 3 | ✅ |
| Recargas e 1 uso por turno | `cooldowns/*` | ✅ selo na barra e no painel | ✅ |

### Apresentação

| Item da Fase 4 | Status |
|---|---|
| Ícones | ✅ 10 habilidades, 14 itens, 5 estados, 4 classes, 8 ações (41). ❌ 8 ícones de "recursos" (PV/PA/PM/Foco…) da seção 7.3 |
| VFX | ✅ todas as habilidades, estados, superfícies, explosão, objetos, água, altar, baú ([vfx.md](vfx.md)) |
| SFX principais | ✅ WebAudio procedural, volume nas opções |
| Feedback de dano / estados | ✅ números, d20, dados, barras com ícones/turnos, rótulos de fim de estado, reações, bloqueio |
| Cooldowns | ✅ |
| Modelos | ⚠️ personagens GLB estáticos; objetos/armas ainda provisórios (primitivas) |
| Animações | ⚠️ "falsas" (deslocamento/inclinação do modelo inteiro) — modelos sem esqueleto |
| Definições por dados | ✅ habilidades/itens/estados/objetos/classes/mapa/montagem são dados; nenhum código por habilidade |

## Decisões (tomadas sem consulta)

1. **Escolha de personagens** antecipada da Fase 5 no mínimo necessário: tela local e editor no lobby. Sem conta/persistência da escolha (fica na URL / na sala).
2. **Pontos de início do 2 × 2**: (6,0) para A e (9,15) para B, simétricos por rotação de 180°.
3. **Consumíveis iniciais padrão**: Poção de vida + Poção de Foco (plano: dois de tipos diferentes). O duelo fixo do mapa (`?seed=` sem `?setup=`, e2e antigos, servidor sem `teamSize`) continua sem consumíveis para não mudar os registros das Fases 2 e 3.
4. **Ids dos personagens**: `<classe>-0N`, numerados por classe (o duelo padrão continua `warrior-01` × `mage-01`).
5. **Rede**: a composição muda antes do `START_MATCH` substituindo o snapshot 0 no banco; o servidor valida tudo (classe desconhecida → padrão da posição, acessório inválido → nenhum, consumíveis repetidos/demais descartados). A classe do adversário não é enviada antes de ser vista (só a projeção).
6. **SFX sintetizados** (WebAudio) em vez de arquivos: sem assets binários, determinísticos, fáceis de ajustar; trocar por amostras depois só muda `Sfx.play`.
7. **`?dice=average`** no cliente local, só para roteiros/capturas — partidas normais continuam com dados aleatórios.
8. **Fundo das armas PNG** removido na geração da versão web (mestres intactas).
9. **Alvo na própria célula** (pergunta em aberto): o plano (seções 2–6, 14.8) não proíbe. O motor aceita ataque/habilidade hostil na própria célula (sem d20, dano em si; a Investida em si mesmo anda uma célula e se golpeia); arco e Tiro preciso recusam (`TOO_CLOSE`). **Mantido** e documentado no cenário `combat/attack_own_cell`. Recomendação: decidir se ações hostis devem recusar a própria célula (uma verificação em `resolveTarget`; o cenário teria de mudar).

## Comportamentos ambíguos mantidos (documentados em cenários)

- **Óleo lançado sobre fogo** (`reactions/oil_flask_on_fire`): só a célula em chamas incendeia; as outras células da cruz recém-lançada continuam óleo (fogo existente não se espalha para óleo vizinho). O plano diz "incendeia imediatamente" sem dizer se é a mancha toda.
- **Raio de geada que erra** (`reactions/frost_ray_miss_still_cools_cell`): sem dano nem Lentidão, mas o frio na célula apaga o fogo e remove Queimando do alvo errado.
- **Explosão perto de quinas** (`objects/barrel_explosion_limits`): célula diagonal fica de fora se uma das quinas for parede.
- **Poção em outro personagem** (`items/health_potion_self_only_capped`): o alvo explícito é ignorado e quem usa se cura (não é recusado).

## Lacunas conhecidas

- **Modelos e animações definitivos**: personagens sem esqueleto (animações por código), armas não presas à mão, objetos ainda provisórios. Exige trabalho de arte (rig/animação no Blender).
- **8 ícones de recursos** (seção 7.3) não feitos.
- **Sons**: sintetizados, funcionais mas simples; sem música nem som ambiente. O contexto de áudio só começa após o primeiro clique/tecla (política dos navegadores).
- Calor + espinhos, calor + madeira, óleo sobre fogo e espinhos incompatíveis são verificados no Lab/vitest, não nas partidas roteirizadas do 3D (os efeitos visuais deles são os mesmos de superfícies/objetos em chamas já exercitados). Destruir uma porta inteira (30 PV) também só no Lab.
- O roteiro 3D usa dados em média fixa (determinístico); com dados aleatórios a mesma interface é usada pelos e2e das Fases 2/3.
- Rede: o editor do lobby não sabe a equipe antes de entrar (por isso a classe "Automática"); sem trocar a escolha depois de entrar na sala.
- Do plano fora do domínio: cronômetro de 45 s (o servidor usa 60 s configurável — `TURN_SECONDS`) e derrota por abandono confirmado (sala abandonada só é encerrada) — ver fase-03.
