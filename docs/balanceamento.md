# Balanceamento (Fase 6)

Objetivo (seção 15, Fase 6, do [plano](plano_mvp_rpg_tatico.md)): "Balanceamento · Ajustes de dano · Ajustes de custos · Ajustes de cooldown · Ajustes do mapa · Ajustes da IA". Meta adotada: **cada classe entre 40 % e 60 % de vitórias** contra as outras (espelhos fora, empate = meia vitória), com o bot difícil dos dois lados, **sem mudar regras** — só dados de conteúdo e pesos/configuração da IA.

## Como rodar

| Comando | O que faz | Tempo nesta máquina (16 núcleos) |
|---|---|---|
| `npm run balance [-- N [N2v2]]` | bot difícil × bot difícil, Pátio das Ruínas, dados aleatórios, sem acessório, Poção de vida + Poção de Foco. 1 × 1: os **16 pares ordenados** de classes, N partidas cada (padrão 100 → 200 por par não ordenado, metade de cada lado); 2 × 2: N2v2 composições sorteadas (padrão 160). Saída em `tools/balance/out/<LABEL>.md` e `.json` | ~15–18 min (100 + 400) |
| `npm run balance:difficulty [-- N [pares]]` | níveis do bot em lote (padrão `hard:normal,hard:easy,normal:easy`, 320 partidas cobrindo as 16 combinações de classes, lados alternados) | ~3–4 min |
| `npm run bots:sim [-- N]` | simulação da Fase 5 (sem paralelismo; mantida) | ~1,5 min |
| `npm run batch:invariants [-- N]` | lote de invariantes (ver [fase-06.md](fase-06.md) e abaixo) | ~10–35 min para 2000 |

Variáveis: `LABEL` (nome da saída), `SEED` (semente inicial; padrão 1), `DIFF` (nível dos dois lados; padrão `hard`), `WORKERS` (padrão: núcleos), e duas para **experimentar sem editar arquivos** (aplicadas só nos workers do lote):

- `BALANCE_PATCH` — mescla profunda no catálogo, ex.: `BALANCE_PATCH='{"items":{"weapon.iron_sword":{"damage":"1d8+11"}},"classes":{"mage":{"hp":86}}}'`;
- `AI_PATCH` — o mesmo para `WEIGHTS` do bot (`packages/ai/src/evaluate.ts`), ex.: `AI_PATCH='{"threat":0.4}'`.

Arquivos: `tools/balance/index.ts` (relatório), `tools/balance/difficulty.ts` (níveis), `tools/batch/match.ts` (uma partida + estatísticas + invariantes), `tools/batch/pool.ts` / `worker.ts` (worker_threads). `packages/ai/src/simulate.ts` passou a aceitar equipes de 1–2 personagens (`characters`) e um gancho `onStep` (estado antes/depois + eventos oficiais), sem mudar o uso antigo.

O relatório traz: taxa por classe (1 × 1 e 2 × 2), matriz de confrontos com rodadas médias, vantagem da equipe A, motivos de término, comandos recusados pelo core, dano causado/recebido, cura, jogadas e acerto por classe, **uso de cada habilidade/arma/item por partida** e interações com o ambiente (superfícies criadas, reações, barris detonados, explosões, objetos destruídos).

## Ponto de partida (conteúdo 0.1.0, IA da Fase 5)

`LABEL=base npm run balance -- 100 160` — 1600 partidas 1 × 1 + 160 partidas 2 × 2:

| Classe | 1 × 1 (600 partidas sem espelho) | 2 × 2 |
|---|---|---|
| Guerreiro | **73,3 %** (434 V · 12 E · 154 D) | 64,2 % |
| Mago | **38,8 %** (233 · 0 · 367) | 33,1 % |
| Ladino | 44,0 % (262 · 4 · 334) | 62,0 % |
| Druida | 43,8 % (257 · 12 · 331) | 37,8 % |

| 1 × 1 (linha × coluna) | Guerreiro | Mago | Ladino | Druida |
|---|---|---|---|---|
| **Guerreiro** | — | 73,0 % | 77,5 % | 69,5 % |
| **Mago** | 27,0 % | — | 37,0 % | 52,5 % |
| **Ladino** | 22,5 % | 63,0 % | — | 46,5 % |
| **Druida** | 30,5 % | 47,5 % | 53,5 % | — |

Rodadas médias 14,6; 76 empates por limite de rodadas em 1600; equipe A 52,1 %. Dano causado por partida: Guerreiro 131, Ladino 121, Druida 116, Mago 106. Uso notável: Investida 1,2 por partida (pouco), Enraizar 0,5 e Espinheiro 0,2 (o bot quase não usa), Empurrão ~0.

Níveis do bot (`balance:difficulty -- 320 hard:normal`, conteúdo e IA originais): **difícil 46,1 % × normal** — o difícil não era melhor que o normal (a tabela da Fase 5, 14 × 10 em 24 partidas, era ruído).

## Iterações (40 partidas por par ordenado = 240 por classe; erro-padrão ≈ 3 pontos)

| Variação (`BALANCE_PATCH`) | Guerreiro | Mago | Ladino | Druida |
|---|---|---|---|---|
| Espada 1d8+13 → 1d8+11 | 65,0 % | 47,1 % | 46,9 % | 41,0 % |
| Cota reforçada 4 → 3 | 74,4 % | 43,8 % | 44,6 % | 37,3 % |
| Guerreiro 110 → 100 PV | 69,6 % | 46,3 % | 44,4 % | 39,8 % |
| Espada 1d8+10 | 58,5 % | 48,8 % | 46,9 % | 45,8 % |
| Espada 1d8+11 + Cajado 1d4+11 | 58,8 % | 41,7 % | 41,9 % | 57,7 % |
| Espada 1d8+11 + Druida 100 PV | 63,3 % | 45,4 % | 45,2 % | 46,0 % |
| **Espada 1d8+10 + Cajado 1d4+10** (+160 2 × 2) | 50,0 % | 43,3 % | 53,1 % | 53,5 % |
| idem + Mago 85 PV (+160 2 × 2) | 47,9 % | 45,8 % | 52,7 % | 53,5 % |
| 2 × 2 com 400 partidas: só armas × armas + Mago 86 PV | — | **29,9 % → 36,2 %** | 59,9 % → 57,2 % | 52,2 % → 48,4 % |

Leitura: o dano da Espada é a alavanca do Guerreiro (cada ponto ≈ 4 pontos de taxa); armadura e PV mexem pouco. O Cajado é muito sensível (+2 levou o Druida de 41 % a 58 %), por isso só +1. O Mago ficava no limite inferior no 1 × 1 e bem abaixo no 2 × 2 (é o alvo preferido de dois adversários: 80 PV e armadura 0).

## Mudanças adotadas

Conteúdo (`CONTENT_VERSION` 0.1.0 → **0.2.0**; `version` das definições alteradas +1, como manda o princípio de versionamento — partidas registram a versão usada):

| Definição | Antes | Depois | Por quê |
|---|---|---|---|
| `weapon.iron_sword` (Espada de ferro) | 1d8+13 (média 17,5) | **1d8+10** (média 14,5) | Guerreiro 73 % no 1 × 1, 64 % no 2 × 2: 110 PV + armadura 4 + Defesa 14 e o maior dano básico. Mexer no dano (e não em PV/armadura) mantém a identidade "tanque" e foi a única alavanca eficaz |
| `weapon.nature_staff` (Cajado natural) | 1d4+9 (11,5) | **1d4+10** (12,5) | Druida em 44 % e quem mais apanha (168 de dano recebido por partida); o cajado é a ação dele em ~14 de ~40 comandos |
| `mage` (classe Mago) | 80 PV | **86 PV** | Mago no limite inferior do 1 × 1 e em 30 % no 2 × 2 |

Nada de custo, recarga, alcance ou regra mudou. Mapa: sem mudança (a equipe A — pontos de início em y = 0 — fica em 49–52 %; nenhuma posição dominante apareceu nos números).

IA (`packages/ai/src/bot.ts`):

1. **Difícil: valor esperado na sequência.** O planejamento do difícil avaliava a folha da sequência no estado "acertou" de cada ataque com chance ≥ 50 %, superestimando ataques arriscados. Agora parte do valor esperado da primeira ação e soma o ganho esperado das seguintes. Sozinho não mudou o placar (45,9 % × normal): testamos também ameaça 0,4 e 0 (`AI_PATCH`), profundidade 0/1 e feixe 8 — todos 45–51 %. A ameaça do adversário quase não discrimina posições neste mapa (com 5–6 PM e alcances de 5–7, o inimigo alcança o bot de quase qualquer célula).
2. **Normal com "deslizes":** 25 % de chance de ficar com a **segunda melhor** opção quando ela está a até 12 pontos da melhor (`DIFFICULTY.normal.secondBest`, `SECOND_BEST_MARGIN`) — nunca troca uma jogada muito melhor (ex.: o barril ao lado do inimigo) por uma ruim. Com isso a ordem dos níveis voltou a valer (tabela abaixo). Decisão: como o difícil não ficou melhor que o normal com ajustes de peso, a diferença entre os níveis vem de o normal errar um pouco, como o plano descreve para os níveis abaixo do difícil.
3. **Nunca mirar a própria célula** (o core aceita ataque na própria célula — cenário `combat/attack_own_cell`); o fácil, na escolha ao acaso, chegava a se derrotar assim. Encontrado pelo lote de invariantes.

Câmera: nenhuma mudança (fora do escopo deste lote; sem problema óbvio apontado pelos números).

## Resultado (conteúdo 0.2.0 + IA ajustada)

`LABEL=depois npm run balance -- 100 400` — 1600 partidas 1 × 1 + 400 partidas 2 × 2, mesmas sementes do ponto de partida no 1 × 1:

| Classe | 1 × 1 antes | **1 × 1 depois** (600 sem espelho) | 2 × 2 antes | **2 × 2 depois** (~205) |
|---|---|---|---|---|
| Guerreiro | 73,3 % | **48,3 %** (287 V · 6 E · 307 D) | 64,2 % | **48,8 %** |
| Mago | 38,8 % | **54,3 %** (326 · 0 · 274) | 33,1 % | **43,0 %** |
| Ladino | 44,0 % | **46,3 %** (277 · 2 · 321) | 62,0 % | **59,2 %** |
| Druida | 43,8 % | **51,0 %** (302 · 8 · 290) | 37,8 % | **47,9 %** |

| 1 × 1 depois (linha × coluna) | Guerreiro | Mago | Ladino | Druida |
|---|---|---|---|---|
| **Guerreiro** | — | 50,0 % | 62,5 % | 32,5 % |
| **Mago** | 50,0 % | — | 48,5 % | 64,5 % |
| **Ladino** | 37,5 % | 51,5 % | — | 50,0 % |
| **Druida** | 67,5 % | 35,5 % | 50,0 % | — |

- Rodadas médias 14,5 (antes 14,6); 48 empates por limite em 1600 (antes 76); equipe A 50,5 %; 406 comandos recusados pelo core em 159 mil (informação oculta).
- Dano causado por partida: Guerreiro 129, Ladino 129, Druida 126, Mago 126 (antes 131 / 121 / 116 / 106).
- Uso por partida: Investida 4,3 (antes 1,2 — com a espada mais fraca a Investida passou a valer a pena), Chama 5,3, Barreira 3,1, Raio de geada 1,7, Tiro preciso 3,7, Ocultação 2,3, Cura natural 3,1; continuam quase sem uso **Enraizar (0,25), Espinheiro (0,21) e Empurrão (~0)**.
- Ambiente por partida 1 × 1: espinhos criados 0,47, fogo 0,33, barris detonados 0,21, calor + óleo 0,11, caixotes 0,11, portas destruídas 0,19 (a porta é aberta em ~95 % das partidas).
- 2 × 2 por composição: Ladino+Ladino 66 % (55), Druida+Ladino 58 %, Druida+Druida 37 % (43); as demais 44–55 %.

Níveis do bot (`npm run balance:difficulty -- 320`, conteúdo 0.2.0):

| Confronto | Antes | Depois |
|---|---|---|
| difícil × normal | 46,1 % | **54,5 %** |
| difícil × fácil | — | **85,3 %** |
| normal × fácil | — | **78,1 %** |

`npm run bots:sim -- 24` (Fase 5, 24 partidas): difícil × fácil 20 · 3 · 1; normal × fácil 20 · 2 · 2; difícil × normal 12 · 10 · 2 (16 ms por decisão no difícil, 4,5 no normal).

## Expectativas de teste alteradas (intencionalmente)

Todas por causa das três mudanças de conteúdo (dados em "média fixa": d8 = 5, d4 = 3 → Espada 15 em vez de 18, Cajado 13 em vez de 12; Mago +6 PV):

| Arquivo | Mudança |
|---|---|
| `tests/scenarios/combat/sword_vs_armor_and_barrier` | é o exemplo numérico da seção 2.3 (espada 18 × armadura 4 × barreira 6 = 8): mantido com `DEBUG_SET_RNG { forced: [11, 8] }` antes do ataque (d8 = 8 → 18); descrição explica |
| `tests/scenarios/abilities/druid_root`, `combat/attack_own_cell`, `items/iron_sword_same_floor_only`, `items/armor_leather_rogue_druid`, `items/armor_tunic_mage` | espada 18 → 15 (PV e `raw`/`hpDamage`/`hpAfter`; textos de nome/descrição) |
| `tests/scenarios/abilities/mage_arcane_barrier_lasts`, `statuses/barrier_no_stacking` | espada 15 é toda absorvida pela barreira 18: sobram 3 de barreira (antes 0); Mago 86 PV |
| `tests/scenarios/items/nature_staff` | cajado 12 → 13 |
| `tests/scenarios/items/frost_medallion`, `items/ash_medallion`, `objects/barrel_explosion_limits`, `abilities/warrior_charge_blocked_by_unit`, `surfaces/thorns_and_fire_exposure` | Mago +6 PV (mesmo dano) |
| `tests/unit/dummy-options.test.ts` | dano da espada no boneco 18 → 15 |
| `tests/unit/charge.test.ts` | PV do Mago 80 → 86 (dano da Investida inalterado) |
| `tests/unit/match-setup.test.ts`, `tests/unit/content-limitations.test.ts` | `maxHp` do Mago 80 → 86; com o Amuleto 88 → 94 |
| `tests/unit/bots.test.ts` ("usam o ambiente") | o normal confere a **melhor opção avaliada** (pode deslizar para a 2ª); o difícil tem de usar o barril em alguma ação do turno (com valor esperado ele às vezes ataca o inimigo primeiro e o barril depois) |
| `tools/e2e/ciclo.ts`, `tests/integration/ciclo.test.ts` | conferência do Mago com amuleto na arena: `maxHp` 88 → 94 |

Novo cenário de regressão: `tests/scenarios/match/active_defeated_on_own_turn` (ver abaixo). Os documentos das fases anteriores (fase-04/05) registram os valores da época e não foram reescritos.

## Bug encontrado pelo lote de invariantes

`npm run batch:invariants -- 2000` (antes da correção): 5 partidas 2 × 2 em 2000 **travaram** — o personagem da vez foi derrotado no próprio turno (atacou a própria célula; o mesmo vale para explosão de barril ao lado ou fogo) e, como o aliado continuava vivo, a partida seguia com a vez presa num personagem derrotado: `END_TURN` dele é recusado (`ACTOR_DEFEATED`) e nem o cronômetro do servidor conseguiria passar a vez. Correção no core (`packages/domain/src/turns/turns.ts`, `endTurnIfActiveDefeated`, chamado no fim de `applyCommand`): o turno é encerrado automaticamente (`TURN_ENDED` com `automatic: true`), como já acontecia com a derrota no início do turno. Coberto pelo cenário `match/active_defeated_on_own_turn`. Resultado do lote depois da correção em [fase-06.md](fase-06.md) / abaixo.

Lote de invariantes depois de todas as mudanças (`npm run batch:invariants -- 2000`, 654 s com 16 workers): **2000 partidas** (1600 1 × 1 com os 16 pares de classes e dificuldades variadas + 400 2 × 2), 216 477 comandos aceitos conferidos um a um, **0 violações**, 0 partidas sem resultado, rodada máxima 20 (= limite), 219 empates; 100 partidas repetidas com a mesma semente → **mesmo hash do estado final em todas** (determinismo). Invariantes conferidos a cada comando: nenhuma exceção; PV ≤ máximo, vivo ⇔ PV > 0; PA/PM/Foco inteiros em [0, máximo]; barreira ≥ 0; ≤ 2 consumíveis; personagem vivo só em célula caminhável e sem dividir célula; PV de objeto em [0, máximo]; personagem da vez vivo; rodada não volta; projeção de cada equipe sem inimigo vivo não detectado (e sem faltar o detectado) e sem a semente dos dados. Versão rápida no `npx vitest run`: `tests/unit/batch-smoke.test.ts` (2 partidas 1 × 1, uma 2 × 2, repetição de semente e o verificador acusando estados inválidos; ~5 s).

## Ressalvas

- **Os números medem o bot, não pessoas.** O bot difícil subusa Enraizar, Espinheiro e Empurrão (efeitos de controle/área que a avaliação valoriza pouco) e não "kita" (a ameaça quase não varia neste mapa); um jogador que use bem o controle do Druida ou o Empurrão do Guerreiro perto do fogo/óleo pode deslocar o equilíbrio. Os números são uma linha de base para a Fase 7 (métricas de jogadores reais: taxa de vitória por classe, uso de habilidades).
- Um mapa só (Pátio das Ruínas), sem acessórios e sempre Poção de vida + Poção de Foco; acessórios (Amuleto +8 PV, medalhões) e o Frasco de óleo não entraram no lote.
- Matriz com pares fortes: Druida × Guerreiro 67,5 % e Mago × Druida 64,5 % (o Druida cura e resiste ao corpo a corpo do Guerreiro; o Mago supera a cura do Druida com dano à distância). Aceito como "pedra-papel-tesoura" leve; fora da meta só se passasse de ~70 %.
- 2 × 2 (fora do ciclo da Fase 5, que é 1 × 1): Mago 43 % e Ladino 59 % — dentro da meta, mas Ladino+Ladino 66 % e Druida+Druida 37 % são composições extremas com amostra pequena (~50).
- Erro-padrão: ~2 pontos por classe nas rodadas de 600 partidas, ~3,5 no 2 × 2 (~200 por classe), ~3 nas iterações.
