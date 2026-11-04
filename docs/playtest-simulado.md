<!-- Gerado por `npm run playtest:sim` — não editar à mão. -->

> ⚠️ **DADOS SIMULADOS.** Este relatório vem de uma simulação local do teste externo (Fase 7): jogadores robôs com o mesmo código do cliente, dias simulados e ritmo acelerado. Ele serve para validar a coleta e o cálculo das métricas — **não** diz nada sobre se o jogo é divertido. O critério de aprovação da Fase 7 continua pendente até o teste com pessoas reais (docs/fase-07.md).

Conferências da simulação: ✅ produção: /debug desligado (404) · ✅ produção: teste externo ligado, cadastro só com convite (versão v0.7.0 · af9053c) · ✅ cliente de produção servido na mesma porta (build v0.7.0 · af9053c) · ✅ cadastro sem código de convite recusado.

Resumo da execução: 74 partidas jogadas (1 PvP), 5 abandonos, 1 desistências, 22 revanches jogadas, 48 pesquisas, 2 bugs; 209 s. Duração média calculada: 16,0 s.

# Relatório do teste externo (Fase 7)

> **DADOS SIMULADOS — 16 jogadores simulados (npm run playtest:sim, semente 7); ritmo de jogo acelerado (durações e tempos por turno não são reais). Não usar para decidir o beta.**

Gerado em 2026-11-04 05:52:44 UTC · janela início → agora · conteúdo 0.2.0 · 16 jogadores · 74 partidas

## Decisão: avançar para o beta? (critérios de go/no-go)

Cada critério só vale com a amostra mínima; "sem dados" não conta a favor nem contra. A decisão final é humana: leia também os comentários e os bugs (docs/fase-07.md, "Modelo de decisão").

| Critério | Alvo | Valor | Amostra (mín.) | Situação |
|---|---|---|---|---|
| Diversão média (pesquisa, 1–5) | ≥ 3,5 | 3,81 | 48 (10) | ✅ ok |
| "Jogaria de novo" (sim + talvez) | ≥ 70 % | 100 % | 48 (10) | ✅ ok |
| Clareza média (entendeu o que acontecia, 1–5) | ≥ 3,5 | 3,08 | 48 (10) | ⚠️ atenção |
| Câmera média (ajudou, 1–5) | ≥ 3,5 | 3,42 | 48 (10) | ⚠️ atenção |
| Taxa de abandono (partidas iniciadas) | ≤ 15 % | 7 % | 74 (20) | ✅ ok |
| Taxa de revanche (partidas terminadas) | ≥ 20 % | 30 % | 74 (20) | ✅ ok |
| Retorno D1 | ≥ 30 % | 38 % | 16 (8) | ✅ ok |
| Retorno D7 | ≥ 15 % | 13 % | 16 (8) | ⚠️ atenção |
| Duração média da partida terminada | 5–20 min | 16,0 s | 74 (20) | ⚠️ atenção |
| Vitórias por classe (todos os participantes) dentro de 40–60 % | todas as classes com ≥ 20 jogos | — | 16 (20) | … sem dados |
| Bot normal "na medida" (pesquisa, 1–5; 3 = na medida) | média 2,5–3,5 | 3,00 | 10 (5) | ✅ ok |
| Erros de cliente por sessão (telemetria) | ≤ 0,1 | 0,00 | 23 (20) | ✅ ok |

## Métricas principais (plano, Fase 7)

| Métrica | Valor |
|---|---|
| Duração média da partida | 16,0 s (mediana 14,1 s, p90 27,0 s, 74 partidas terminadas) |
| Tempo médio por turno (jogadores, servidor) | 1,0 s (mediana 1,0 s, p90 1,6 s, 988 turnos; 0 esgotados pelo cronômetro) |
| Tempo médio por turno (medido no cliente) | 1,0 s (885 turnos com telemetria) |
| Classe mais utilizada (jogadores) | Mago |
| Taxa de vitória por classe | Mago 41 % (58) · Guerreiro 43 % (40) · Ladino 59 % (34) · Druida 31 % (16) |
| Habilidade mais utilizada | Chama concentrada (193 usos, 4,83/partida da classe) |
| Habilidade menos utilizada | Espinheiro (0 usos, 0/partida da classe) |
| Explosões | 15 (em 14 partidas) |
| Interações ambientais | 248 (3,35 por partida terminada) |
| Taxa de abandono | 7 % (5 de 74 iniciadas) |
| Taxa de revanche | 30 % (22 de 74 terminadas) |
| Partidas contra bot | 73 (fácil 37 · normal 17 · difícil 19) |
| Retorno de jogadores | D1 38 % (6/16) · D7 13 % (2/16) · em até 7 dias 38 % |

## Jogadores e partidas

Jogadores cadastrados: **16** (16 jogaram ao menos uma partida; 14 jogaram 3 ou mais). Telemetria: 14 aceitaram, 2 recusaram.

Partidas por jogador: 4,69 (mediana 4, p90 8, n = 16).

Partidas: **74** — por modo: contra bot: 73 · online (fila): 1; por situação: terminada: 74.

Resultados: vitória (elimination): 60 · empate (roundLimit): 8 · vitória (surrender): 6. Rodadas por partida terminada: 13,41 (mediana 14, p90 20, n = 74).

Códigos de convite usados: SIM-GRUPO (16).

Turnos do bot (inclui a pausa de animação): 0,2 s (mediana 0,1 s, p90 0,4 s, n = 956).

## Classes

| Classe | Escolhas (jogadores) | % das escolhas | Vitórias de jogadores | Taxa (jogadores) | Taxa (todos, inclui bots) | Jogos (todos) | Taxa PvP |
|---|---|---|---|---|---|---|---|
| Mago | 40 | 53 % | 17/40 | 43 % | 41 % | 58 | 0 % (1) |
| Guerreiro | 16 | 21 % | 7/16 | 44 % | 43 % | 40 | — |
| Ladino | 16 | 21 % | 9/16 | 56 % | 59 % | 34 | 100 % (1) |
| Druida | 3 | 4 % | 1/3 | 33 % | 31 % | 16 | — |

## Habilidades, armas e itens (comandos aceitos de jogadores)

**Habilidades**

| Habilidade | Classe | Usos | Partidas com a classe | Usos por partida |
|---|---|---|---|---|
| Chama concentrada | Mago | 193 | 40 | 4,83 |
| Barreira arcana | Mago | 125 | 40 | 3,13 |
| Investida | Guerreiro | 75 | 16 | 4,69 |
| Tiro preciso | Ladino | 54 | 16 | 3,38 |
| Raio de geada | Mago | 33 | 40 | 0,83 |
| Ocultação | Ladino | 29 | 16 | 1,81 |
| Cura natural | Druida | 7 | 3 | 2,33 |
| Empurrão | Guerreiro | 3 | 16 | 0,19 |
| Enraizar | Druida | 1 | 3 | 0,33 |
| Espinheiro | Druida | 0 | 3 | 0 |

**Ataques básicos**

| Arma | Usos | Usos por partida da classe |
|---|---|---|
| Espada de ferro | 139 | 8,69 |
| Varinha arcana | 121 | 3,03 |
| Arco curto | 113 | 7,06 |
| Cajado natural | 33 | 11 |
| Adaga | 4 | 0,25 |

**Consumíveis**

| Item | Usos | Usos por partida |
|---|---|---|
| Poção de vida | 53 | 0,72 |
| Frasco de óleo | 0 | 0 |
| Poção de Foco | 0 | 0 |

**Comandos por tipo**

| Tipo | Quantidade |
|---|---|
| END_TURN | 954 |
| MOVE | 914 |
| USE_ABILITY | 520 |
| BASIC_ATTACK | 410 |
| DEFEND | 383 |
| INTERACT | 136 |
| USE_ITEM | 53 |
| SURRENDER | 1 |

## Interações ambientais

Explosões: **15** (partidas com explosão: 14). Objetos incendiados: 6. Portas/interações (INTERACT): 197.

Objetos destruídos: barrel: 15 · crate: 14 · door: 7. Reações: heat_oil: 8 · cold_effect_remove_burning: 1.

Superfícies criadas: 77. Deslocamentos forçados: 7.

Interações ambientais (total) = INTERACT + objetos destruídos + reações + objetos incendiados. Contam as jogadas de todos os participantes (inclui os bots), a partir dos eventos oficiais.

## Abandono e revanche

Iniciadas: 74. Derrota por abandono (saiu e não voltou na reserva): 5. Abandonadas pelos dois lados: 0. Desistências voluntárias: 1 (1 %). Canceladas antes de começar (alguém não entrou): 0.

Saídas no meio da partida vistas pelo cliente: lobby_button: 2 · pagehide: 2.

Revanche por modo: contra bot 22/73 · online (fila) 0/1. Cliques em "Revanche": 21.

## Bots

| Dificuldade | Partidas | Terminadas | Vitória dos jogadores | Duração média | Rodadas | Percepção (1 = muito fácil, 3 = na medida, 5 = muito difícil) |
|---|---|---|---|---|---|---|
| fácil | 37 | 37 | 54 % (20) | 13,8 s | 12,84 | 1,84 (n = 25; 7/15/3/0/0) |
| normal | 17 | 17 | 41 % (7) | 19,6 s | 15,35 | 3,00 (n = 10; 0/2/6/2/0) |
| difícil | 19 | 19 | 32 % (6) | 16,9 s | 12,89 | 4,36 (n = 11; 0/0/2/3/6) |

## Retorno de jogadores

Coorte: 16 jogadores. D1 = voltou no dia seguinte ao cadastro (UTC); D7 = voltou no 7º dia; "em até 7 dias" = qualquer dia de 1 a 7. Só entram os jogadores cujo dia já chegou.

D1: 6/16 (38 %) · D7: 2/16 (13 %) · em até 7 dias: 6/16 (38 %). Dias ativos por jogador: 1,63 (mediana 1, p90 3, n = 16).

## Interface e câmera (telemetria, por partida)

Sessões: 23 de 14 navegadores; duração 48,5 s (mediana 52,1 s, p90 1 min 23 s, n = 23). Eventos: 695. Erros de cliente: 0.

Telas vistas: lobby: 66 · match: 66 · result: 62 · character: 14 · login: 14.

Builds: v0.7.0 · af9053c (23 sessões).

Recusas de comandos de jogadores por código (servidor): HIDE_NOT_ALLOWED: 4 · NO_PATH: 4.

| Sinal | Média por partida | Total |
|---|---|---|
| mira cancelada | 4,42 | 292 |
| câmera: arrastar com o mouse | 9,44 | 623 |
| câmera: mover pelo teclado | 13,48 | 890 |
| câmera: girar | 11,8 | 779 |
| câmera: zoom | 14,15 | 934 |
| troca de andar | 2,09 | 138 |
| ajuda aberta | 0,3 | 20 |
| opções abertas | 0,14 | 9 |
| visão geral | 1,33 | 88 |
| turnos jogados | 13,41 | 885 |
| ação indisponível clicada | 2,94 | 194 |

## Pesquisa pós-partida

Respostas: **48** (pesquisa aberta 62 vezes; puladas 18).

Diversão: 3,81 (mediana 4,00, p90 5,00, n = 48) — 1★…5★: 0 / 2 / 16 / 19 / 11.

Clareza: 3,08 (mediana 3,00, p90 4,00, n = 48) — 0 / 8 / 28 / 12 / 0.

Câmera: 3,42 (mediana 3,00, p90 4,00, n = 48) — 0 / 0 / 28 / 20 / 0.

Equilíbrio percebido (−2 muito contra mim … +2 muito a meu favor): média 0,00 — -2: 0 · -1: 14 · 0: 20 · 1: 14 · 2: 0.

Jogaria de novo: sim 40 · talvez 8 · não 0.

Diversão por modo: contra bot 3,80 (46) · online (fila) 4,00 (2). Por classe: Mago 4,04 (24) · Ladino 4,00 (12) · Guerreiro 2,90 (10) · Druida 4,50 (2).

**Comentários (mais recentes)**

| Quando | Modo | Resultado | Classe | Diversão | Comentário |
|---|---|---|---|---|---|
| 2026-11-04 05:52 | contra bot | vitória | Mago | 5 | [simulado] Partida tensa até o fim, quero jogar de novo. |
| 2026-10-31 05:52 | contra bot | derrota | Mago | 4 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-31 05:51 | contra bot | derrota | Ladino | 4 | [simulado] Partida tensa até o fim, quero jogar de novo. |
| 2026-10-29 05:51 | contra bot | vitória | Ladino | 4 | [simulado] O bot fácil é bom para aprender as regras. |
| 2026-10-29 05:51 | contra bot | vitória | Mago | 5 | [simulado] Adorei acender o óleo e ver o barril explodir em cadeia. |
| 2026-10-29 05:51 | contra bot | derrota | Ladino | 3 | [simulado] A câmera às vezes fica atrás da parede. |
| 2026-10-29 05:51 | contra bot | vitória | Ladino | 5 | [simulado] O bot fácil é bom para aprender as regras. |
| 2026-10-29 05:51 | contra bot | derrota | Ladino | 4 | [simulado] Adorei acender o óleo e ver o barril explodir em cadeia. |
| 2026-10-29 05:51 | contra bot | vitória | Ladino | 5 | [simulado] Adorei acender o óleo e ver o barril explodir em cadeia. |
| 2026-10-29 05:51 | contra bot | derrota | Mago | 3 | [simulado] A câmera às vezes fica atrás da parede. |
| 2026-10-28 05:50 | contra bot | derrota | Mago | 3 | [simulado] As partidas poderiam ser mais curtas. |
| 2026-10-28 05:50 | contra bot | vitória | Mago | 4 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-28 05:50 | contra bot | vitória | Guerreiro | 4 | [simulado] Partida tensa até o fim, quero jogar de novo. |
| 2026-10-28 05:50 | contra bot | derrota | Mago | 3 | [simulado] Não sabia de quem era a vez no começo. |
| 2026-10-28 05:50 | contra bot | empate | Mago | 4 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-28 05:50 | contra bot | derrota | Guerreiro | 3 | [simulado] As partidas poderiam ser mais curtas. |
| 2026-10-28 05:50 | contra bot | empate | Druida | 4 | [simulado] O bot fácil é bom para aprender as regras. |
| 2026-10-28 05:50 | contra bot | vitória | Mago | 4 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-28 05:50 | contra bot | vitória | Mago | 4 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-28 05:50 | contra bot | vitória | Mago | 5 | [simulado] O bot fácil é bom para aprender as regras. |
| 2026-10-28 05:49 | contra bot | vitória | Ladino | 5 | [simulado] O mago com raio de gelo é muito divertido. |
| 2026-10-28 05:49 | contra bot | vitória | Ladino | 4 | [simulado] Partida tensa até o fim, quero jogar de novo. |
| 2026-10-28 05:49 | contra bot | derrota | Mago | 3 | [simulado] Queria ver a área da habilidade antes de clicar. |
| 2026-10-28 05:49 | contra bot | vitória | Mago | 5 | [simulado] Gostei de subir na plataforma e atirar de cima. |
| 2026-10-28 05:49 | contra bot | derrota | Mago | 5 | [simulado] O mago com raio de gelo é muito divertido. |
| 2026-10-28 05:49 | contra bot | derrota | Ladino | 3 | [simulado] A câmera às vezes fica atrás da parede. |

## Relatórios de bug

Total: **2** (2 com o relatório da partida anexado) — por categoria: interface: 1 · conexao: 1. Reproduza com `npm run regression:from-match` a partir do JSON baixado no painel.

| Quando | Categoria | Partida | Anexo | Descrição |
|---|---|---|---|---|
| 2026-10-29 05:51 | interface | 38db8fc8 | sim | [simulado] O botão da habilidade continuou aceso sem Foco suficiente. |
| 2026-10-28 05:50 | conexao | 51ce609a | sim | [simulado] Caiu a conexão por alguns segundos e voltou sozinho. |
