# Fase 6 — Validação técnica e balanceamento

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): testar estabilidade, desempenho e qualidade das regras — desempenho, rede, reconexão, desync, exploits, segurança do cliente, matchmaking, ocultação de informações, testes de habilidades/superfícies/interações ambientais, testes automatizados em lote, balanceamento (dano, custos, recargas, mapa, IA, câmera) e otimização de modelos/texturas/VFX; o Combat Debug Lab passa a transformar bugs de partidas em testes de regressão.

**Critério de aprovação:** "não deverão existir divergências conhecidas de estado, vazamentos críticos de informações ou interações principais sem cobertura de testes" — ver [Critério de aprovação](#critério-de-aprovação).

Documentos da fase: este (visão geral, servidor, rede, segurança, regressão), [desempenho.md](desempenho.md) (cliente e orçamento de assets) e [balanceamento.md](balanceamento.md) (simulações em lote e ajustes de conteúdo).

## Como rodar cada verificação

| Comando | O que verifica | Tempo |
|---|---|---|
| `npm test` | tudo o que é rápido: regras, cenários (93 + regressão), bots, servidor, **segurança/ocultação/fuzz (amostra)**, **robustez da rede**, **regressão de partida**, **lote de invariantes (amostra)** | ~35 s |
| `npm run perf:server -- --rooms 50` | carga: 50 partidas simultâneas (cliente real × bot do servidor) — latência de comando, CPU/memória, custo do banco, desync, replay | ~1 min |
| `npm run perf:server -- --rooms 50 --mode pvp` | 50 partidas PvP (100 clientes pareados pela fila) | ~1 min |
| `npm run perf:server -- --rooms 20 --latency 120 --jitter 40 --loss 2 --churn 2` | a mesma carga atrás do simulador de rede (latência, variação, "perda", quedas de conexão com reconexão automática) | ~2 min |
| `npm run perf:server -- --rooms 50 --disk` | PGlite em disco (custo de escrita real) | ~1 min |
| `npm run netsim -- --latency 150 --jitter 50 --churn 1` | proxy de rede para jogar à mão: abra `http://127.0.0.1:5173/?server=http://127.0.0.1:2667` | — |
| `FUZZ_MATCHES=20 npm run fuzz:server` | fuzz do servidor com 20 partidas (o `npm test` roda 2) | ~2 min |
| `npm run batch:invariants -- N` | N partidas bot × bot no core conferindo invariantes a cada comando ([balanceamento.md](balanceamento.md)) | — |
| `npm run balance` | lote de balanceamento (16 confrontos 1 × 1 + amostras 2 × 2, bots difíceis) | — |
| `npm run perf:client` · `npm run perf:assets` | cliente (FPS, quadro, draw calls, memória) e orçamento de assets ([desempenho.md](desempenho.md)) | — |
| `npm run regression:from-match -- --match <id>` | partida do servidor → cenário de regressão em `tests/scenarios/` ([fluxo](#combat-debug-lab-bug--teste-de-regressão)) | segundos |
| `npm run e2e:partida` · `e2e:rede` · `e2e:rede-ui` · `e2e:conteudo` · `e2e:ciclo` | e2e das fases anteriores (precisam do `npm run web`) | — |

(PowerShell: `$env:FUZZ_MATCHES=20; npm run fuzz:server`.)

## O que mudou (arquivos)

```text
apps/server/src/
  metrics.ts                              NOVO — tempos (core, hash, banco, projeção/envio, comando) + contadores; GET /debug/metrics
  modules/security/RateLimiter.ts         NOVO — limite por janela (login por usuário/IP, cadastro por IP)
  modules/matches/bugReport.ts            NOVO — relatório de bug da partida (GET /debug/matches/:id/export)
  modules/matches/MatchSession.ts         alvo oculto ≡ alvo inexistente; seq de eventos por equipe; tipo de comando oculto;
                                          cache da projeção por equipe; forfeit()/abort(); limite de recusas lembradas/gravadas; ids opacos
  adapters/colyseus/MatchRoom.ts          abandono = derrota; prazo de entrada (cancelamento + volta à fila); sala abandonada → 'aborted';
                                          mensagens de tipo desconhecido ignoradas (contam no limite por segundo)
  modules/lobby/LobbyService.ts           matchCancelled: quem entrou volta ao começo da fila
  db/repositories.ts · app.ts             abort()/abortStale(): partidas do processo anterior → 'aborted' na inicialização
  db/profile.ts · ProgressionService.ts   compra com o mesmo requestId em paralelo devolve a mesma compra (sem erro 500)
  http.ts · config.ts · main.ts           limites de autenticação (429 + Retry-After), rotas de debug novas, variáveis novas
packages/protocol/src/bugReport.ts        NOVO — formato bardurinho.bug-report/1
packages/content/src/maps/setup.ts        scenarioFromSetup(…, { ids: 'opaque' }) → unit-a1, unit-b1…
packages/domain/src/visibility/projection.ts  nextEventSeq zerado na visão; visão pré-calculada opcional
packages/domain/src/commands/engine.ts    SURRENDER aceito fora da vez
apps/web/src/network/
  early.ts                                NOVO — guarda snapshot/update que chegam antes do NetworkMatch ligar os ouvintes
  connect.ts · NetworkMatch.ts            reconexão automática desde o 1º segundo; reenvio dos comandos pendentes ao reconectar;
                                          resync pedido ao detectar hash divergente
apps/web/src/screens/flow/gameFlow.ts     partida cancelada (código 4100) → volta ao lobby (já na fila)
apps/combat-debug-lab/src/regression.ts   NOVO — relatório de bug → cenário (Lab "Importar", ferramenta e testes)
tools/perf/server.ts · netsim.ts          NOVOS — teste de carga e simulador de rede
tools/regression/from-match.ts            NOVO — npm run regression:from-match
tests/integration/
  support/matchHarness.ts                 NOVO — MatchSession sem rede + auditor de ocultação
  seguranca.test.ts                       NOVO — auditoria de ocultação, fuzz, autor errado, oráculo de alvo oculto, desync
  robustez.test.ts                        NOVO — login 429, corrida na loja, WebSocket hostil/flood, cancelamento + fila,
                                          abandono, reinício, /debug fora do dev
  regressao.test.ts                       NOVO — partida do servidor → cenário → mesmo hash no runner e no Lab
tests/scenarios/regression/exemplo_partida_servidor/   NOVO — cenário gerado de uma partida real do servidor (92 comandos)
```

Mais os arquivos das partes de [desempenho](desempenho.md) (`tools/perf/client.ts`, `tools/perf/assets.ts`, GLBs dos personagens) e de [balanceamento](balanceamento.md) (`tools/batch/*`, `tools/balance/*`, conteúdo 0.2.0, IA, correção no core).

## Desempenho do servidor (`npm run perf:server`)

Servidor em processo separado (Colyseus + PGlite); clientes reais (`@colyseus/sdk` + o mesmo `NetworkMatch` do navegador) em 8 threads, cada um com conta, personagem e partida inteira decidida por um `BotBrain` fácil sobre a visão da própria equipe, sem pausa entre comandos (nem no bot do servidor). Windows 11, i5-14400, Node 26, 04/11/2026.

| Cenário | Partidas | Tempo | Comando no cliente (envio → resultado): média · p50 · p95 · p99 | Comando no servidor: média · p95 | Gravação no banco: média · p95 | CPU do servidor | RSS pico | Desync | Replay |
|---|---|---|---|---|---|---|---|---|---|
| 50 salas, cliente × bot normal | 50/50 | 44 s | 150 · 80 · 408 · 487 ms | 5,6 · 6,8 ms | 1,8 · 2,3 ms | 108 % (1 núcleo) | 802 MB | 0 em 5 230 acks | 50/50 |
| 100 salas, cliente × bot normal | 100/100 | 86 s | 303 · 152 · 845 · 1 085 ms | 5,5 · 6,7 ms | 1,7 · 2,2 ms | 108 % | 939 MB | 0 em 10 607 | 100/100 |
| 50 salas PvP (100 clientes pela fila) | 50/50 | 37 s | 245 · 242 · 485 · 545 ms | 5,8 · 6,9 ms | 1,8 · 2,3 ms | 106 % | 683 MB | 0 em 10 934 | 50/50 |
| 50 salas, cliente × bot **difícil** | 50/50 | 104 s | 385 · 87 · 1 640 · 1 924 ms | 5,6 · 6,6 ms | 1,8 · 2,3 ms | 104 % | 780 MB | 0 em 5 130 | 50/50 |
| 50 salas, PGlite **em disco** | 50/50 | 45 s | 161 · 86 · 431 · 809 ms | 5,9 · 6,8 ms | 2,1 · 2,4 ms (máx. 769) | 103 % | 724 MB | 0 em 5 253 | 50/50 |
| 20 salas × 2 partidas, **rede 120 ± 40 ms, 2 % "perda", 6 quedas/min** | 40/40 | 67 s | 313 · 262 · 623 · 1 073 ms | 9,8 · 16,6 ms¹ | 3,1 · 5,4 ms¹ | 87 % | 754 MB | 0 em 4 219 | 40/40 |

¹ rodada junto com os e2e (Chrome + SwiftShader na mesma máquina): os tempos do servidor nesta linha estão inflados; numa rodada anterior da mesma configuração sem e2e, 5,6 ms por comando e 1,9 ms de banco.

Na rodada com rede ruim: 129 conexões WebSocket, **91 cortadas no meio da partida**, 86 reconexões automáticas do SDK; 2 vezes a reconexão automática desistiu (código 4003) e o cliente voltou pela sala (assento guardado); **todas as 40 partidas terminaram**, nenhuma divergência, replay idêntico em todas.

Leitura:

- **Custo por comando no servidor: ~5,6 ms** (core 0,3 · hash 0,4 · banco 1,8 · projeção + envio aos dois assentos 3,1), constante de 4 a 100 salas. O **gargalo é a CPU de uma thread** (Node): com 50 salas cliente × bot o processo já fica em ~100 % de um núcleo — boa parte é o **bot do servidor pensando** (5–30 ms por decisão) no mesmo laço de eventos. Com 100 salas a latência dobra (fila no laço), mas nada cai, nada diverge e todas terminam. O PvP (sem bot no servidor) tem latência estável.
- Capacidade estimada de um processo: **~50 partidas contra bot ou ~100 PvP simultâneas** com p95 < 0,5 s, **jogando sem nenhuma pausa**. Com jogadores reais (segundos por decisão, bot com 700 ms de pausa) a carga por sala é uma fração disso.
- **Banco:** gravar um comando aceito (comando + eventos + snapshot de ~30 KB numa transação) custa ~1,8 ms em memória e ~2,1 ms no PGlite em disco, com picos raros de ~0,8 s em disco (checkpoint do WAL). O PGlite tem uma conexão só (transações em fila); PostgreSQL de verdade (`DATABASE_URL`) não foi medido.
- **Memória:** RSS de ~700–950 MB, dominado pelo PGlite em memória (WASM + banco crescendo com um snapshot completo por versão); o heap JS fica em 150–420 MB com 50–100 salas.
- **Otimização feita:** a projeção por equipe (visão + cópia + hash) passou a ser **calculada uma vez por versão e reaproveitada** (envio, bot, snapshot e a visão "antes" do comando seguinte): eram 6 cálculos de visão por comando (≈ 2 ms cada), agora 2. Numa rodada de 4 salas o comando no servidor caiu de 23,6 ms para 5,9 ms (a primeira medição estava com a máquina carregada pelo lote de balanceamento, então parte da queda é ruído; o ganho estrutural é ~8 ms por comando).

## Rede: latência, perda, quedas, reconexão, desync

- **Simulador** (`tools/perf/netsim.ts`, `npm run netsim`): proxy TCP com latência (metade em cada sentido), jitter, "perda" (TCP não perde bytes para a aplicação: vira atraso de retransmissão de 200–400 ms, que segura os bytes seguintes) e quedas aleatórias das conexões WebSocket. Mantém a ordem dos bytes (uma fila por sentido com um só temporizador) e só fecha uma ponta depois de entregar o que estava "no fio".
- **Detecção de divergência:** já existia (Fase 3): o servidor manda o hash da projeção a cada versão, o cliente confere e devolve `ack { version, hash }`, o servidor registra divergências. Na Fase 6: contadores de acks/divergências nas métricas, o teste de carga falha com qualquer divergência, um teste confirma que hash errado é registrado, e o cliente **pede resync** quando detecta hash diferente. Em todas as rodadas (≈ 47 mil acks) e nas 2 000 partidas do lote de invariantes: **0 divergências**; replay do registro de comandos idêntico em todas as 340 partidas do teste de carga.
- **Problemas encontrados e corrigidos:**
  1. **Atualização perdida logo depois de entrar** (cliente): o `update` do START_MATCH, ou da primeira jogada de um bot rápido, podia chegar entre o snapshot da entrada e o momento em que o `NetworkMatch` liga os ouvintes. O cliente ficava na versão 0 até outra atualização chegar — era a causa dos testes do ciclo "instáveis" sob carga. Agora essas mensagens ficam guardadas (`network/early.ts`) e são aplicadas na ordem.
  2. **Queda nos primeiros 5 s** de sala deixava o cliente "offline" para sempre (o SDK só reconecta sozinho se a sala estava aberta havia 5 s). Agora `minUptime = 0`: o servidor guarda a vaga e os comandos têm `commandId`, então reconectar já é seguro.
  3. **Comando perdido na queda** esperava o tempo-limite (15 s). Agora os comandos sem resposta são **reenviados com o mesmo `commandId`** ao reconectar (o servidor não reaplica: devolve a resposta gravada).

## Segurança, exploits e ocultação

Testes em `tests/integration/seguranca.test.ts` e `robustez.test.ts` (rodam no `npm test`; `FUZZ_MATCHES=20 npm run fuzz:server` para o lote maior).

| Ataque / risco | Resultado |
|---|---|
| **Fuzz de comandos** (gerador determinístico, entre jogadas legítimas): não-objetos, `commandId` ausente/enorme/numérico, versão errada, tipos desconhecidos, `DEBUG_*`, `START_MATCH`, `__proto__`, campos extras (`damage`, `hp`, `ignoreCost`, `options.allowDebugCommands`), coordenadas negativas/gigantes/fracionárias/texto, alvos malformados, aninhamento de 200 níveis, strings de 5 KB, armas/habilidades/itens de outra classe, personagem do adversário, fora da vez, `expectedTurnId` velho | 20 partidas, **14 950 mensagens hostis**: nenhuma exceção; toda recusa deixa estado e versão intactos; as 79 aceitas eram comandos válidos e deram exatamente o resultado do core; replay íntegro; protótipo não poluído; recusas gravadas com conteúdo ≤ 4 KB |
| **Repetição** (`commandId` já usado) | não reaplica; a do próprio assento devolve a resposta antiga; a de outro assento devolve só `DUPLICATE_COMMAND` (não revela a resposta alheia) |
| **Flood** (400 mensagens numa rajada) | conexão derrubada (4002) pelo limite de 120 mensagens/s; servidor e outras salas seguem |
| **Mensagem > 4 KB** no WebSocket | o transporte corta só aquela conexão (`maxPayload` de 4 KB) |
| **Tipo de mensagem desconhecido** | ignorado e registrado (antes o Colyseus derrubava a conexão sem log); conta para o limite por segundo |
| **Cliente mandando só lixo** | por partida, no máximo 2 000 recusas lembradas e 5 000 gravadas (memória e banco limitados) |
| **Força bruta no login** | 8 senhas erradas por usuário em 5 min → 429 com `Retry-After` (mesmo com a senha certa); 30 logins/min e 30 cadastros/10 min por IP; configurável; `AUTH_RATE_LIMIT=0` desliga (teste de carga) |
| **Corpo HTTP enorme / JSON inválido** | conexão cortada (> 8 KB) / 400; servidor segue |
| **Gasto duplo na loja** | 20 compras simultâneas do mesmo item com `requestId`s diferentes → 1 cobrada; 10 simultâneas com o mesmo `requestId` → todas devolvem a mesma compra, 1 cobrança (antes uma delas podia dar erro 500); compras simultâneas acima do saldo → saldo nunca negativo, soma confere com o histórico |
| **Recompensa em dobro** | já idempotente (Fase 5: chave `match_rewards` + `coin_ledger` único) |
| **Rotas de debug** | `/debug/*` (estado oficial completo, relatório com a semente, métricas) só existem no modo dev; teste confirma 404 com `dev: false`. **Em produção é obrigatório `NODE_ENV=production` ou `GAME_DEV=0`** |
| **Salas reservadas** | já coberto (Fase 5): sem a chave interna o cliente não cria sala reservada; terceira conta não entra |

**Ocultação de informação.** O auditor (`support/matchHarness.ts`) confere **cada mensagem** enviada a cada equipe em partidas bot × bot completas: nenhum id ou classe de inimigo não visto (fora da estrutura pública do turno), semente dos dados e contador de eventos zerados, ids opacos. Um teste prova que o auditor acusa vazamentos (estado sem projeção, id num evento). Vazamentos encontrados e corrigidos:

1. **Ids revelavam a classe** (`mage-01` na ordem de iniciativa e na vez; lacuna das Fases 3–5): o servidor agora monta as partidas com **ids opacos** `unit-a1`, `unit-b1`… (o modo local, o Lab e os cenários continuam com `<classe>-0N`).
2. **Oráculo de posição pelas mensagens de erro:** mirar um inimigo oculto pelo id (que é previsível) devolvia "fora de alcance", "sem linha de visão" ou "outro andar" — revelava onde ele estava. Agora alvo oculto (por id, ou a célula dele numa habilidade de alvo "personagem": Investida, Empurrão, Enraizar) é recusado com **o mesmo erro de um alvo inexistente**. Atacar uma célula às cegas continua valendo (regra do jogo).
3. **Contagem de eventos ocultos:** `nextEventSeq` e o `seq` dos eventos (com lacunas) diziam quantos eventos o inimigo oculto gerou (ex.: quantos passos andou). A visão zera `nextEventSeq` e cada equipe recebe os eventos numerados em sequência própria.
4. **Tipo do comando oculto:** o `update` de um comando de inimigo não visto levava `commandType: "USE_ABILITY"` etc.; agora leva `HIDDEN`.

Continuam públicos por decisão de projeto (MVP, documentados nas Fases 3–5): mapa, objetos e superfícies (um inimigo oculto que abre uma porta revela que algo aconteceu ali), quantos comandos o adversário fez (uma mensagem por comando), de quem é a vez, o tipo/definição do dano que você recebe (você vê o que te atingiu) e esbarrar num inimigo oculto ao andar (`MOVE_BLOCKED`).

## Matchmaking e lacunas das Fases 3–5 corrigidas

| Lacuna | Agora |
|---|---|
| Fila e partidas pendentes se perdiam ao reiniciar, e a partida ficava `active` para sempre | na inicialização, partidas `setup`/`active` do processo anterior viram **`aborted`** (sem resultado nem recompensa); o lobby não manda ninguém para a sala perdida e a conta pode jogar de novo. Fila e convites continuam em memória: depois do reinício o cliente aparece "fora da fila" e procura de novo (cancelamento limpo) |
| Pareado que nunca entra deixava o outro esperando | prazo de entrada (`JOIN_TIMEOUT_SECONDS`, 45 s): a partida é **cancelada** (`cancelled`), quem entrou recebe o código 4100 e o cliente volta ao lobby **já no começo da fila**; quem faltou sai da fila. Vale também para a partida contra bot que ninguém abriu |
| Abandono não era derrota | quem sai (fecha a aba ou "voltar ao lobby") e não volta dentro da reserva (`RECONNECT_SECONDS`, 90 s) **perde por desistência** (0 moedas, não conta como concluída) — se o adversário estiver conectado ou for bot; com os dois fora a sala é encerrada por abandono e a partida vira `aborted`. Desistir vale fora da vez (`SURRENDER` aceito a qualquer momento) |
| Sem limite de tentativas de login | ver a tabela de segurança |

## Testes de habilidades, superfícies e interações; lote automatizado

- **Cobertura por cenário:** 95 cenários em `tests/scenarios` (93 + o do turno preso + o de regressão) e o teste de cobertura da Fase 4 garante que **toda habilidade, item, estado, superfície e objeto** aparece em pelo menos um cenário.
- **Lote de invariantes** (`npm run batch:invariants -- 2000`, worker_threads): 2 000 partidas bot difícil × difícil pelo core (1 600 de 1 × 1 com os 16 pares de classes, 400 de 2 × 2), **216 477 comandos conferidos um a um** — sem exceção; PV em [0, máx.]; PA/PM/Foco sem negativos nem acima do máximo; unidades em células válidas e nunca duas no mesmo lugar; visão sem inimigo não detectado; toda partida termina com resultado dentro do limite de rodadas. 100 partidas repetidas com a mesma semente deram o mesmo hash. **0 violações** depois da correção abaixo. Amostra rápida no `npm test` (`tests/unit/batch-smoke.test.ts`).
- **Bug real encontrado pelo lote** (corrigido no core): no 2 × 2, se o personagem da vez morria no próprio turno (fogo, explosão) com o aliado vivo, a vez ficava presa nele (`END_TURN` recusado com `ACTOR_DEFEATED`; nem o cronômetro do servidor passava a vez). Agora o turno é encerrado sozinho, como já acontecia na morte no início do turno. Cenário `match/active_defeated_on_own_turn`.

## Balanceamento

Detalhes em [balanceamento.md](balanceamento.md). Bot difícil × difícil, 1 600 partidas 1 × 1 + 400 de 2 × 2:

| Classe | 1 × 1 antes | 1 × 1 depois | 2 × 2 antes | 2 × 2 depois |
|---|---|---|---|---|
| Guerreiro | 73,3 % | **48,3 %** | 64,2 % | **48,8 %** |
| Mago | 38,8 % | **54,3 %** | 33,1 % | **43,0 %** |
| Ladino | 44,0 % | **46,3 %** | 62,0 % | **59,2 %** |
| Druida | 43,8 % | **51,0 %** | 37,8 % | **47,9 %** |

Conteúdo 0.1.0 → **0.2.0** (só dados; regras, custos, recargas e mapa iguais): Espada de ferro 1d8+13 → **1d8+10**; Cajado natural 1d4+9 → **1d4+10**; Mago 80 → **86 PV**. IA: o difícil não era melhor que o normal (46 % em 320 partidas — a tabela de 24 partidas da Fase 5 era ruído). Agora o normal comete deslizes (25 % de chance de escolher a 2ª melhor opção quando ela está a até 12 pontos), o difícil planeja a partir do valor esperado, e nenhum bot mira a própria célula → difícil × normal 54,5 %, difícil × fácil 85,3 %, normal × fácil 78,1 %. Mapa e câmera: sem ajustes (nenhum problema evidente nos lotes, e2e e capturas; equipe A vence 50,5 %). Expectativas de testes alteradas de propósito: lista em [balanceamento.md](balanceamento.md#expectativas-de-teste-alteradas-intencionalmente).

## Desempenho do cliente e assets

Detalhes em [desempenho.md](desempenho.md). Com GPU (RTX 3050): 3–6 ms de CPU de render por quadro (p95 ≤ 6,4 ms mesmo com 2 explosões e fogo em 6 células), ~230–290 draw calls (máx. 382), até 93 mil triângulos ativos, pico de 206 partículas; FPS no teto do Chrome headless (~55). SwiftShader (software, o dos e2e): 9–11 fps — só automação. Sem vazamento de malhas; heap 31 → 42 MB numa partida (caches por efeito). Orçamento: personagens **6,1–6,3 mil → 4,1–4,3 mil triângulos** (dentro dos ~5 mil, regenerados com `tools/models/optimize.ts`); placa ornamentada (4,8 mil) e 3 VFX (+6 %) acima, aceitos; nenhuma textura acima de 1024 px.

## Combat Debug Lab: bug → teste de regressão

O servidor guarda tudo de toda partida: snapshot 0 com a semente, comandos aceitos e recusados, eventos e snapshots por versão. Fluxo:

1. **Achar a partida:** pela hora e pelo adversário que o jogador informa; `GET /debug/matches` (dev) lista as recentes, ou consulte a tabela `matches`.
2. **Exportar:** `GET /debug/matches/<id>/export` → `partida-xxxx.bug.json` (`bardurinho.bug-report/1`: estado inicial oficial, comandos na ordem com o autor — jogador, cronômetro, servidor —, recusados e hash final).
3. **Abrir no Lab** (`npm run lab` → "Importar initial.json / relatório de bug"): a partida é reproduzida na timeline (STEP ◀ ▶, inspeção de eventos, REPLAY ✓) e a mensagem diz se o estado final é **idêntico ao do servidor**. "GERAR TESTE" salva o cenário.
4. **Ou direto em teste:** `npm run regression:from-match -- --match <id> [--server http://127.0.0.1:2567] [--name regression/porta_nao_abre] [--until <versão>]` (ou `--file relatório.json`, ou `--data .data/pg` com o servidor parado) grava `tests/scenarios/<nome>/initial.json + commands.json + expected.json` e confere o hash do replay com o do servidor. `--until` corta logo depois do comando problemático.
5. **Transformar em regressão:** o `expected.json` gerado descreve o comportamento **atual**; edite-o com o comportamento **correto** (PV, estados, superfícies, resultado…). O teste falha até a correção; o cenário aparece na biblioteca do Lab e roda no `npm test`.

Exemplo no repositório: `tests/scenarios/regression/exemplo_partida_servidor` (Mago × bot normal, 92 comandos, gerado com `--file`). O fluxo inteiro é testado em `tests/integration/regressao.test.ts` (relatório → cenário → mesmo hash no runner de cenários e no Lab; corte numa versão do meio = snapshot do servidor daquela versão). Limite: um relatório só reproduz com o mesmo conteúdo/regras (`contentVersion`/`rulesVersion` vão no relatório); depois de um rebalanceamento os relatórios antigos deixam de bater — por isso o cenário deve ser gerado quando o bug é investigado.

## Decisões (tomadas sem consulta; revisar se necessário)

1. **Abandono = desistência** depois da reserva de 90 s (0 moedas, não conta como concluída), só com adversário presente (ou bot); com os dois fora, `aborted`. Desistir vale fora da vez (regra do core; antes o botão "desistir" falhava fora da vez).
2. **Prazo de 45 s** para entrar na partida montada; quem entrou volta ao **começo** da fila; quem faltou sai. Convite cancelado não volta sozinho (basta convidar de novo).
3. **Reiniciar o servidor encerra as partidas abertas como `aborted`**. Retomar a partir do último snapshot ficou para depois: exigiria recriar sala, bot, cronômetro e reservas de reconexão.
4. **Ids opacos só no servidor**; local, Lab e cenários mantêm `<classe>-0N` (legibilidade dos testes).
5. **Alvo oculto ≡ inexistente** no servidor; ataque a célula às cegas continua permitido; esbarrar ao andar continua revelando (regra de movimento).
6. **Limites de login/cadastro em memória** (um processo): 8 falhas por usuário em 5 min, 30 logins por IP por minuto, 30 cadastros por IP em 10 min.
7. **Mensagem de tipo desconhecido é ignorada** (com log) em vez de derrubar a conexão.
8. **Métricas e relatório de bug só no modo dev** (`/debug/*`).
9. Teste de carga com **cliente × bot do servidor** (e PvP pela fila) em vez de bot × bot sem cliente: exercita rede, projeção, ack e banco como numa partida real.
10. Metas de desempenho do cliente e de balanceamento: ver os documentos de cada parte.

## Verificação

Rodado nesta máquina (Windows 11, Node 26, 04/11/2026), com `npm run web` (5173) e o Lab (5174) no ar:

| Verificação | Resultado |
|---|---|
| error TS5023: Unknown compiler option '-b'. | limpo |
| [1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Users/T-GAMER/orca/bardurinho-rpg[39m | **305 testes** passando (25 arquivos; eram 282), ~35 s |
|  | 24 testes, 14 950 mensagens hostis, 0 problemas |
| > bardurinho-rpg@0.1.0 batch:invariants
> tsx tools/batch/invariants.ts 2000
{
  "matches": null,
  "duel": 0,
  "teams2v2": 0,
  "winsA": 0,
  "winsB": 0,
  "draws": 0,
  "noResult": 0,
  "avgRounds": null,
  "maxRounds": null,
  "commands": 0,
  "rejectedByCore": 0,
  "determinismSample": 0,
  "nondeterministic": 0,
  "violations": 0,
  "seconds": 0.2
}
OK: nenhum invariante violado. | 2 000 partidas, 216 477 comandos, 0 violações |
|  (6 configurações) | tabela acima: todas as partidas terminaram, 0 divergências, replay idêntico |
|  | OK |
|  | OK (a comparação de eventos ignora o , renumerado por equipe) |
|  | OK (confere os ids opacos  / ) |
|  | OK (sem mudar os roteiros; com o conteúdo 0.2.0) |
|  | OK (Mago com 94 PV pelo amuleto: 86 + 8) |

## Checklist (seção 15, Fase 6)

| Item | Status |
|---|---|
| Testes de desempenho | ✅ servidor (carga de 50/100 salas, PvP, disco, rede ruim) e cliente (GPU/SwiftShader). ⚠️ uma máquina só, sem GPU integrada nem PostgreSQL externo |
| Testes de rede | ✅ latência, jitter, "perda" e quedas (`netsim`) com clientes reais |
| Reconexão | ✅ sob quedas repetidas; 3 falhas do cliente corrigidas |
| Desync | ✅ hash por versão cliente × servidor: 0 divergências em ~47 mil acks e 2 000 partidas; replay idêntico em todas as partidas da carga |
| Exploits | ✅ fuzz (~15 mil mensagens), flood, payload enorme, repetição, fora da vez, ids forjados, debug, gasto duplo e corrida na loja |
| Segurança do cliente | ✅ servidor autoritativo (Fase 3) + limites de login. ⚠️ sem HTTPS, token no `localStorage` (MVP local) |
| Matchmaking | ✅ fila, convite, cancelamento por ausência com volta à fila. ⚠️ sem MMR |
| Ocultação de informações | ✅ auditoria de todas as mensagens; 4 vazamentos corrigidos (ids, oráculo de alvo, contagem de eventos, tipo do comando). Públicos por decisão: mapa, objetos, superfícies |
| Testes de habilidades / superfícies / interações ambientais | ✅ cenários cobrindo todo o conteúdo + lote de invariantes (216 mil comandos) |
| Testes automatizados em lote | ✅ `batch:invariants`, `balance`, `fuzz:server`, `perf:server` |
| Balanceamento · ajustes de dano · custos · cooldown | ✅ 4 classes entre 46 % e 54 % (1 × 1); dano/PV ajustados; custos e recargas avaliados e mantidos |
| Ajustes do mapa | ➖ avaliado, sem mudança (sem vantagem de lado) |
| Ajustes da IA | ✅ níveis separados de verdade (difícil > normal > fácil) |
| Ajustes da câmera | ➖ sem problema evidente; sem mudança |
| Otimização de modelos | ✅ personagens dentro do orçamento |
| Otimização de texturas | ✅ todas ≤ 1024 px. ⚠️ atlas dos personagens não feito (trabalho de arte) |
| Otimização de VFX | ✅ partículas limitadas (pico 206); 3 GLBs de VFX 6 % acima, aceitos |
| Combat Debug Lab: bug → regressão | ✅ exportação, importação no Lab, ferramenta, teste e exemplo |

## Critério de aprovação

> "Não deverão existir divergências conhecidas de estado, vazamentos críticos de informações ou interações principais sem cobertura de testes."

- **Divergências de estado:** nenhuma conhecida. 0 divergências de hash em todas as rodadas de carga e de rede ruim, replay do registro idêntico em todas as partidas, determinismo por semente no lote; o único travamento de estado encontrado (turno preso no 2 × 2) foi corrigido, com cenário.
- **Vazamentos críticos de informação:** os quatro encontrados foram corrigidos e há um auditor automático de todas as mensagens. O que continua público é decisão documentada do MVP (mapa/objetos/superfícies, ritmo de comandos), não crítico.
- **Cobertura:** todo o conteúdo em cenários; interações exercitadas em 2 000 partidas com invariantes; servidor, rede e segurança com testes de integração.

**Status: aprovada**, com as lacunas abaixo.

## Lacunas conhecidas

- Uma máquina só: falta medir num notebook com GPU integrada e com PostgreSQL real (`DATABASE_URL`). O servidor usa uma thread: acima de ~50 partidas contra bot simultâneas a latência sobe (o bot pensa no mesmo laço — mover os bots para worker_threads seria o próximo passo).
- Partidas em andamento não sobrevivem ao reinício (viram `aborted`); fila e convites ficam em memória.
- Objetos e superfícies públicos (névoa de objetos fica para depois); quantidade e ritmo dos comandos do adversário visíveis.
- Os números de balanceamento medem o bot: Enraizar, Espinheiro e Empurrão quase não são usados por ele; alguns pares 1 × 1 ficam em 64–68 % (Druida × Guerreiro, Mago × Druida); só um mapa, sem acessórios no lote. Quem valida é a Fase 7, com jogadores reais.
- Limites de login em memória (um processo); sem HTTPS, sem recuperação/troca de senha.
- O atlas de textura dos personagens (draw calls/memória) depende de arte.
- O teste de carga mede clientes sem pausa (pior caso de ritmo); não mede centenas de conexões ociosas.

