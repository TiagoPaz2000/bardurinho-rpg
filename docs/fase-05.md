# Fase 5 — Ciclo completo do jogo

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): transformar o combate isolado numa experiência completa — login, conta, sessão, personagem (aparência, classe), inventário, equipamento, lobby, convites, matchmaking, partidas contra bot (fácil/normal/difícil), loja, moedas, recompensas, missões, histórico, resultado, retorno ao lobby e salvamento de progresso.

**Critério de aprovação:** "um jogador deverá conseguir completar todo o ciclo sem intervenção manual do desenvolvedor" — **atendido** (`npm run e2e:ciclo`, ver "Critério de aprovação"), com as lacunas listadas no fim.

## Como rodar

```bash
npm install
npm run server        # servidor de jogo: http://127.0.0.1:2567 (Colyseus + PGlite em .data/pg; migrações aplicadas sozinhas)
npm run web           # cliente: http://127.0.0.1:5173 → jogo completo (login → personagem → lobby → partida)
```

Abra `http://127.0.0.1:5173/`, crie uma conta (100 moedas de boas-vindas), crie o personagem e jogue contra o bot. Para testar fila/convite, use duas janelas (ou uma anônima) com contas diferentes.

| Endereço | O que abre |
|---|---|
| `/` | **jogo completo** (Fase 5). `?server=http://host:porta` troca o servidor |
| `/?mode=local` | escolha de personagens da partida local (Fase 4, depuração; os dois lados no mesmo navegador) |
| `/?seed=N`, `?setup=…`, `?units=…` | partida local direta (Fases 2/4; usado por `e2e:partida` e `e2e:conteudo`) |
| `/?mode=rede` | lobby de desenvolvimento da Fase 3/4 (contas `jogador-a`/`jogador-b`, senha `dev`) |

| Comando | O que faz |
|---|---|
| `npm run e2e:ciclo` | **critério de aprovação** (precisa do `npm run web`; sobe um servidor próprio na porta 2571, PGlite em memória, bot com pausa de 250 ms). Capturas em `docs/screenshots/fase-05/` |
| `npm run bots:sim [-- N pares]` | simulação em lote bot × bot (padrão: 20 partidas de `hard:easy,normal:easy,hard:normal`); `VERBOSE=1` lista cada partida |
| `npm test` | inclui `tests/integration/ciclo.test.ts`, `tests/unit/bots.test.ts`, `tests/unit/progression.test.ts` |

Variáveis novas do servidor: `BOT_DELAY_MS` (pausa do bot entre comandos, padrão 700 ms — dá tempo de ver as animações).

## Arquitetura

```text
packages/ai/                          NOVO — bots (seção 13), só com o core de regras
  src/bot.ts                          BotBrain.decide(visão da equipe) → GameplayCommand (+ opções avaliadas)
  src/evaluate.ts                     avaliação do estado, campo de deslocamento (Dijkstra), ameaça do adversário
  src/simulate.ts                     runBotMatch: partida bot × bot sem servidor (testes, lote)
packages/content/src/progression/     NOVO — dados e regras puras
  cosmetics.ts                        cosméticos (cor, aparência de classe, retrato, moldura, aura), loja, normalizeAppearance
  progression.ts                      tabela de moedas, participantStats (do resultado oficial), missões, validação de nomes
packages/domain/src/match/summary.ts  resumo da partida (movido do cliente; + barris detonados, dano de explosão atribuído)
packages/protocol/src/api.ts          NOVO — contrato da API HTTP (DTOs) + SeatInfo.character/bot + mensagem `rewards`
apps/server/
  migrations/002_ciclo.sql            contas (tipo, código de amigo, moedas, personagem ativo), personagens, inventário,
                                      coin_ledger, purchases, matches.mode/bot_difficulty, match_rewards, mission_progress
  src/db/accounts.ts                  cadastro/login (scrypt), sessões com validade, logout, busca por usuário/código
  src/db/profile.ts                   personagens, inventário, moedas (com histórico), compras, missões, recompensas, histórico
  src/modules/progression/            ProgressionService: validação de personagem/equipar/loja; settleMatch (recompensa)
  src/modules/lobby/LobbyService.ts   fila, convites, partidas contra bot; cria as salas com assentos reservados
  src/modules/bots/BotSeat.ts         bot como assento da partida (mesma fila/validação dos jogadores)
  src/modules/matches/MatchSession.ts + assentos reservados (conta + personagem), modo, bot, onFinished
  src/adapters/colyseus/MatchRoom.ts  + chave interna, BotSeat, fechamento da partida → mensagem `rewards`
  src/http.ts                         + /auth/register, /auth/logout, /me, /characters, /shop, /missions, /matches, /lobby
apps/web/src/
  network/api.ts                      GameApi (HTTP + token) e sessão da conta em localStorage
  screens/flow/gameFlow.ts            telas: login/cadastro, personagem, lobby (Jogar · Equipamento · Loja · Missões · Histórico),
                                      entrada na partida, recompensas, volta ao lobby
  screens/flow/preview3d.ts           prévia 3D do GLB da classe com a aparência
  screens/flow/portrait.ts            retrato em SVG (emblema, fundo, moldura)
  rendering/appearance.ts             cosméticos aplicados aos materiais do GLB e ao anel (aura)
tools/e2e/ciclo.ts                    critério de aprovação (Chrome headless, só entrada real)
tools/bots/simulate.ts                simulação em lote
```

### Fluxo (seção 12.2)

```text
Login/Cadastro ─► Personagem (criar/escolher) ─► Lobby ─┬─ Jogar contra o bot (fácil/normal/difícil)
                                                       ├─ Procurar partida (fila) ── pareia 2 jogadores
                                                       └─ Convidar (usuário ou código de amigo) ── aceitar
        ─► servidor cria a sala (assentos reservados) ─► cliente entra (joinById + token) ─► Partida
        ─► Resultado (overlay da Fase 2) ─► "Ver recompensas" (calculadas pelo servidor) ─► "Voltar ao lobby"
```

- **Conta e sessão:** `POST /auth/register` (usuário `a-z0-9_-` 3–20, senha ≥ 6) grava a senha com **scrypt** (sal aleatório de 16 bytes, comparação em tempo constante), gera um **código de amigo** e credita 100 moedas (com registro no histórico de movimentações). Login e cadastro abrem uma **sessão por token aleatório** (24 bytes) com **validade de 7 dias** no banco (`sessions.expires_at`); `POST /auth/logout` apaga. Rotas autenticadas por `Authorization: Bearer`. O token fica no `localStorage` (`bardurinho.conta`): recarregar mantém o login.
- **Personagem:** nome (3–16, letras com acento/dígitos/espaço/hífen, único na conta), classe, aparência (só cosméticos gratuitos ou do inventário), acessório e até dois consumíveis de tipos diferentes (`normalizeChoice` da Fase 4). Até 3 por conta; o ativo é usado nas partidas. Nome e classe não mudam depois.
- **Inventário e equipamento:** o inventário guarda os **cosméticos** desbloqueados (loja ou missão). "Equipar" = escolher, por espaço (cor, aparência de classe, retrato, moldura, aura), um cosmético gratuito ou possuído, além do acessório e consumíveis de combate. O servidor recusa cosmético não possuído ou de outro espaço.
- **Loja:** só cosméticos (seção 1: "Loja: apenas itens cosméticos no MVP"; seção 3.2: a progressão não dá vantagem de atributos). Preços do plano: cor alternativa 50, retrato 80, aparência de classe 200 (+ moldura de prata 60, aura arcana 120). `POST /shop/buy { productId, requestId }`: preço **do catálogo** (nunca do cliente), saldo suficiente (`UPDATE … WHERE coins + delta >= 0`, sem saldo negativo — `CHECK` no banco), não possuído, tudo numa transação; o `requestId` do cliente torna a compra **idempotente** (repetir devolve o resultado gravado, sem cobrar de novo). Compras recusadas também ficam registradas (`purchases`).
- **Lobby:** o cliente consulta `GET /lobby/status` a cada segundo (fila, convites, partida montada). Toda partida do ciclo é **criada pelo servidor** (`matchMaker.createRoom` com uma chave interna aleatória do processo): sala privada, **assentos reservados** para as contas com o personagem ativo de cada uma (classe, acessório, consumíveis, nome, cosméticos); outra conta não entra, e um cliente que tente criar uma sala "reservada" sem a chave cai numa sala comum (`custom`). Recarregar no meio da partida volta a ela (sala em `sessionStorage`; ou `status.match` devolve a partida ativa da conta).
- **Matchmaking:** fila por ordem de chegada; dois na fila → partida PvP. Entrada sem consulta por 20 s sai da fila.
- **Convites:** por usuário ou código de amigo; o convidado vê em "Convidar um amigo" e aceita/recusa; quem convidou pode cancelar. Convite expira em 5 min.
- **Partida:** a mesma da Fase 3/4 (servidor autoritativo, visão por equipe, cronômetro, reconexão), 1 × 1 (escopo do MVP: "dois jogadores, cada um controlando um personagem"), Pátio das Ruínas. O nome do personagem aparece na arena e o assento leva nome + cosméticos (públicos; a classe do adversário continua oculta até ser visto). A cor/conjunto visual tingem os materiais do GLB da classe e a aura troca a cor do anel. No painel da partida, "desistir" (dois cliques) envia `SURRENDER`.
- **Resultado → Recompensas → Lobby:** ao fim, o servidor fecha a partida (`settleMatch`) a partir do **resultado oficial** — estado final + eventos persistidos em `match_events` — e manda `rewards` a cada jogador; a tela de resultado ganha "Ver recompensas" (moedas, missões que avançaram, desbloqueios, saldo) e "Voltar ao lobby". Sem a mensagem (recarregou), a tela pergunta `GET /matches/:id/reward`.
- **Recompensa idempotente:** `match_rewards (match_id, account_id)` é a chave; fechar de novo devolve a recompensa gravada sem creditar. O crédito também tem `coin_ledger (account_id, reason, ref)` único (`match:<id>`, `mission:<id>:<período>`, `purchase:<requestId>`).
- **Missões:** as três do plano (permanentes) — "Concluir três partidas" → cor *Veterano*; "Obter a primeira vitória" → moldura *Ouro do vencedor*; "Incendiar dois barris em partidas concluídas" → aura *Brasas* — e duas diárias (data UTC): "Partida do dia" (1 partida, +20) e "Mão pesada" (60 de dano, +15). Progresso calculado no servidor pelos eventos oficiais (`participantStats`: resultado, rendição, dano causado — inclui explosões que o personagem detonou —, barris detonados, também em cadeia).
- **Histórico:** `GET /matches/history` — data, modo (bot + dificuldade, fila, convite), personagem, adversário (nome e classe, revelados no fim), resultado, rodadas e moedas.

### Bots (`packages/ai`, seção 13)

O bot recebe **a visão da sua equipe** (`session.projection(team)` — a mesma projeção enviada a um jogador: sem inimigos não detectados, sem semente dos dados) e devolve um `GameplayCommand` comum; o `BotSeat` o envia por `MatchSession.submit`, ou seja, pela **mesma fila e validação** dos jogadores (formato, `commandId`, autorização, core sem opções de debug). Ele não altera PV, não ignora custo, não conhece posições ocultas e não executa ações inválidas (se o servidor recusar — ex.: um inimigo oculto bloqueia o caminho — o bot não repete o comando e evita o destino por alguns turnos; se nem encerrar o turno for aceito, o cronômetro encerra).

As consequências vêm do próprio core: cada candidato é simulado com `applyCommand` na visão do bot, dados em "média fixa"; ataques com d20 são simulados com acerto (d20 forçado 19) e erro (1) e ponderados pela chance de acerto (`attackHitChance`). Assim o bot "enxerga" dano, estados, superfícies, óleo + fogo, barris em cadeia e explosões sem nenhuma regra copiada.

| Nível | Implementação |
|---|---|
| **Fácil** | só ações imediatas; supõe d20 médio (sem chance de acerto); poucos movimentos (3 melhores + 3 ao acaso); 30 % de chance de escolher uma ação válida ao acaso; às vezes encerra o turno cedo |
| **Normal** | compara valor esperado de dano, cura, barreira, estados, posição (alcance + linha de visão para atiradores, aproximação para corpo a corpo, risco de ficar colado num guerreiro) e ambiente; inclui posições de onde dá para atacar |
| **Difícil** | o normal + **sequências**: para as 4 melhores ações (+ até 3 movimentos até posições de ataque) completa o turno de forma gulosa (até 2 ações a mais) e desconta a **resposta provável** do adversário (dano esperado que os inimigos visíveis conseguem causar no próximo turno deles: células alcançáveis × armas/habilidades × alcance/andar/linha de visão × chance de acerto) |

Exploração sem inimigo à vista: vai à última posição vista, depois aos pontos de início do adversário e então varre uma malha do mapa; portas fechadas no caminho entram no campo de deslocamento com custo extra e são abertas (`INTERACT`). O personagem do bot é sorteado (classe e acessório; Poção de vida + Poção de Foco).

**Simulação em lote** (`npm run bots:sim -- 24`, classes e lados alternados, dados aleatórios, Pátio das Ruínas):

| Confronto | Resultado (24 partidas) |
|---|---|
| difícil × fácil | **difícil 21** · fácil 2 · empates 1 (13,1 rodadas em média) |
| normal × fácil | **normal 21** · fácil 2 · empates 1 (12,1) |
| difícil × normal | **difícil 14** · normal 10 · empates 0 (14,2) |

Comandos recusados pelo core oficial: 3 / 2 / 1 em ~2 000 por confronto (todos por inimigo oculto). Custo: ~5–10 ms por decisão no normal, ~15–30 ms no difícil.

## Decisões (tomadas sem consulta; revisar se necessário)

1. **Rotas da interface:** a raiz (`/`) virou o jogo completo; a partida local de depuração foi para `?mode=local` (os links diretos `?seed=`/`?setup=`/`?units=` continuam indo direto à partida local; `e2e:conteudo` passou a abrir `?mode=local`). O lobby de desenvolvimento (`?mode=rede`, contas `jogador-a`/`jogador-b`) continua, como "partida personalizada" (`custom`): sem moedas nem missões, mas entra no histórico.
2. **Inventário = cosméticos.** O plano fixa armas/armaduras por classe, acessórios e consumíveis liberados desde o início e loja só de cosméticos: não há itens de combate para comprar. "Equipamento" = cosméticos + acessório + consumíveis iniciais.
3. **Aparência sobre os GLBs existentes** (sem modelos novos): cor = tinta nos materiais; "aparência de classe" = brilho emissivo (Cerimonial, Espectral); "variação visual de equipamento" (recompensa de missão) = aura (cor do anel). Retrato e moldura são SVG.
4. **Moedas** (tabela 12.3 + lacunas do plano): PvP vitória 30 / derrota concluída 10 / empate 15; contra bot vitória 10, **empate 5, derrota 3**; **quem se rende recebe 0** e a partida não conta como "concluída" para missões; partidas personalizadas não pagam. 100 moedas de boas-vindas no cadastro (permite a primeira compra antes de jogar).
5. **Missões diárias** extras (o plano só lista as três permanentes): "Partida do dia" e "Mão pesada", período pela data UTC; recompensas creditadas na hora (sem botão "resgatar").
6. **Lobby por consulta HTTP (1 s)** em vez de uma sala de lobby por WebSocket: simples, sem estado de conexão extra, suficiente para rede local. Fila, convites e partidas pendentes ficam **em memória** (reiniciar o servidor esvazia a fila; contas, personagens, moedas, missões e histórico ficam no banco).
7. **Salas do ciclo criadas pelo servidor** com assentos reservados e uma chave interna aleatória por processo (o cliente nunca a recebe). Equipe A = primeiro da fila / quem convidou / o jogador contra o bot.
8. **Bot como conta de sistema** (`bot-facil`, `bot-normal`, `bot-dificil`, sem senha) para manter `match_players.account_id` e o registro de comandos iguais aos de um jogador. O bot fica "conectado" (não conta para abandono).
9. **Bot com pausa de 700 ms** entre comandos (`BOT_DELAY_MS`): o cliente reproduz os eventos em fila, mas sem pausa as ações do bot pareciam instantâneas.
10. **Dano de explosão no resumo:** o dano causado por um barril passa a contar para quem o detonou (também na tela de resultado); antes ficava sem autor (a causa registrada é o barril).
11. **Limite de 3 personagens por conta**; nome único por conta (não global — convites são por usuário/código de amigo).

## Critério de aprovação

`npm run e2e:ciclo` (`tools/e2e/ciclo.ts`), com o `npm run web` rodando; servidor próprio na porta 2571 (PGlite em memória). Três Chrome headless (`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`), **só entrada real** (cliques, digitação com `Input.insertText`, atalhos 1–9, cliques nas células do canvas, Enter); o roteiro decide a jogada com um `BotBrain` difícil lendo o estado projetado da aba (`window.__arena`, só leitura) e a executa pela interface.

1. **Cadastro** (aba "Criar conta") → **criação de personagem** (nome "Lyra Brasa", Mago, cor Rubi, Amuleto da vitalidade) → conferido no servidor (`/me`); 100 moedas no lobby.
2. **Loja:** compra "Ouro velho" (50) → saldo 50, item possuído (servidor). **Equipamento:** equipa a cor comprada e salva → servidor confirma.
3. **Partida contra o bot fácil** até o fim: na arena está o personagem da conta (Mago, nome, 88 PV pelo amuleto); o bot começa fora da visão.
4. **Resultado** → **"Ver recompensas":** moedas pela tabela do modo/resultado, "Concluir três partidas" 0 → 1, "Partida do dia" concluída; saldo = o do servidor.
5. **De volta ao lobby:** saldo novo, missões com o progresso salvo, **histórico** com a partida (modo bot, moedas); **recarregar a página** mantém o login e o saldo.
6. **Dois navegadores (B e C):** cadastro + personagem pela interface; **fila** ("Procurar partida" nos dois) → mesma partida PvP; C desiste pela interface → B recebe 30, C recebe 0; histórico de B mostra a partida contra C. **Convite:** B convida C pelo código de amigo, C aceita → os dois na mesma partida privada; B desiste → histórico de C atualizado.
7. Nenhum erro/aviso no console das três abas.

Registro (03/11/2026): todas as conferências ok em ~131 s — o Mago "Lyra Brasa" venceu o bot fácil por eliminação (10 turnos do jogador), +10 moedas da partida e +35 de missões ("Obter a primeira vitória" → moldura *Ouro do vencedor*, "Partida do dia" +20, "Mão pesada" +15), saldo final 95; PvP e convite encerrados por desistência pela interface; nenhum erro no console.

| Captura | O quê |
|---|---|
| [01-login](screenshots/fase-05/01-login.png) | tela de login/cadastro |
| [02-criar-personagem](screenshots/fase-05/02-criar-personagem.png) | criação: nome, classe, cor, aparência, retrato, acessório, consumíveis, prévia 3D |
| [03-lobby](screenshots/fase-05/03-lobby.png) | lobby (Jogar: bot com dificuldade, fila, convite) |
| [04-loja](screenshots/fase-05/04-loja.png) | loja depois da compra (saldo 50, item possuído) |
| [05-equipamento](screenshots/fase-05/05-equipamento.png) | equipamento com a cor comprada (prévia 3D tingida) e inventário |
| [06-partida-bot](screenshots/fase-05/06-partida-bot.png) | início da partida contra o bot (nome do personagem, painel "Partida", "desistir") |
| [07-resultado](screenshots/fase-05/07-resultado.png) | resultado com "Ver recompensas" / "Voltar ao lobby" |
| [08-recompensas](screenshots/fase-05/08-recompensas.png) | recompensas calculadas pelo servidor (moedas, missões, desbloqueio) |
| [09-missoes](screenshots/fase-05/09-missoes.png) | missões depois da partida |
| [10-historico](screenshots/fase-05/10-historico.png) | histórico |
| [11-fila](screenshots/fase-05/11-fila.png) · [12-pvp-inicio](screenshots/fase-05/12-pvp-inicio.png) · [13-pvp-recompensas](screenshots/fase-05/13-pvp-recompensas.png) | matchmaking com dois navegadores |
| [14-convite](screenshots/fase-05/14-convite.png) | convite pelo código de amigo |

Continuam passando: `npm run e2e:partida`, `npm run e2e:rede`, `npm run e2e:rede-ui`, `npm run e2e:conteudo` (ver "Verificação").

## Testes (`npm test`)

- `tests/integration/ciclo.test.ts` (servidor no mesmo processo, PGlite em memória): cadastro (validação, duplicado, senha em scrypt no banco), login errado, logout invalida o token; personagem (nome, classe, aparência só com itens possuídos, consumíveis normalizados, limite, seleção, nome/classe imutáveis); loja (preço do catálogo, saldo, posse, `requestId` repetido não cobra de novo, produto que não está à venda, histórico de movimentações); **partida jogador × bot até o fim** pelo `NetworkMatch` (o "jogador" é um `BotBrain` no cliente, só com a visão da equipe), recompensa pela tabela, missões, **idempotência** (fechar de novo não credita), histórico, comandos do bot no registro e **replay** conferido; sala reservada não pode ser criada por cliente; **fila** com dois jogadores até o fim (30/10 ou 15) e conta intrusa recusada; **convite** por código de amigo (só o convidado aceita; cancelar); fila sem personagem → 409.
- `tests/unit/bots.test.ts`: para cada nível, 4 partidas completas bot × bot — todo comando é de jogador, tem `expectedTurnId`, é **válido na visão da equipe** (0 inválidos) e recusas oficiais (informação oculta) < 3 %; uso do ambiente (atacar o barril ao lado do inimigo em vez do inimigo); **mesma visão → mesma decisão** onde quer que o inimigo oculto esteja; o bot só joga na própria vez; **lote difícil × fácil** (10 partidas): difícil vence ≥ 7 e mais que o dobro do fácil.
- `tests/unit/progression.test.ts`: tabela de moedas, barris (inclusive em cadeia) e dano de explosão atribuídos a quem detonou, rendição (0 moedas, não concluída), missões e períodos, loja só com cosméticos (nenhum mexe em atributo), aparência, validação de nomes/senha.

## Checklist (seção 15, Fase 5)

| Item | Status |
|---|---|
| Login | ✅ usuário + senha (scrypt), pela interface |
| Conta | ✅ cadastro, nome de exibição, código de amigo, saldo |
| Sessão | ✅ token aleatório com validade (7 dias) no banco, logout, mantida ao recarregar |
| Criação de personagem | ✅ nome, classe, aparência, acessório, consumíveis; até 3 |
| Aparência | ✅ cor, aparência de classe, retrato, moldura, aura — aplicadas ao GLB na prévia e na arena. ⚠️ sem modelos/conjuntos novos (tinta/brilho sobre o mesmo GLB) |
| Seleção de classe | ✅ 4 classes com atributos e kit |
| Inventário | ✅ cosméticos desbloqueados (loja e missões) |
| Equipamento | ✅ cosméticos + acessório + consumíveis, validados no servidor |
| Lobby | ✅ abas Jogar, Equipamento, Loja, Missões, Histórico |
| Convites | ✅ por usuário ou código de amigo; aceitar/recusar/cancelar |
| Matchmaking | ✅ fila FIFO, pareia dois jogadores. ⚠️ sem faixa de habilidade (MVP local) |
| Partidas contra bot | ✅ bot como assento, mesma validação |
| Bot fácil / normal / difícil | ✅ ver tabela e simulação em lote |
| Loja | ✅ só cosméticos, preço/saldo/posse no servidor, idempotente |
| Moedas | ✅ saldo + histórico de movimentações (`coin_ledger`) |
| Recompensas | ✅ do resultado oficial, uma vez por partida e conta |
| Missões | ✅ as 3 do plano + 2 diárias |
| Histórico de partidas | ✅ |
| Tela de resultado | ✅ (Fase 2) + "Você venceu/perdeu" + botões do ciclo |
| Retorno ao lobby | ✅ |
| Salvamento de progresso | ✅ tudo no PostgreSQL/PGlite (`.data/pg`): contas, personagens, inventário, moedas, compras, missões, recompensas, partidas |
| Critério de aprovação | ✅ `npm run e2e:ciclo` |

## Verificação

Rodado nesta máquina (Windows 11, Node 26, Chrome headless):

| Verificação | Resultado |
|---|---|
| `npx tsc -b` | limpo |
| `npx vitest run` | **282 testes** passando (21 arquivos; eram 260) |
| `npm run e2e:ciclo` | OK (critério da Fase 5) |
| `npm run e2e:partida` | OK (Fase 2) |
| `npm run e2e:rede` | OK (Fase 3) |
| `npm run e2e:rede-ui` | OK (Fase 3, interface) |
| `npm run e2e:conteudo` | OK (Fase 4; agora abre a escolha local em `?mode=local`) |
| `npm run bots:sim -- 24` | tabela acima |

## Lacunas conhecidas

- **Fila, convites e partidas pendentes em memória:** reiniciar o servidor os perde (os dados persistentes ficam). Partidas em andamento também não são retomadas depois de reiniciar (lacuna da Fase 3).
- **Lobby por consulta HTTP a cada 1 s** (não WebSocket): até ~1 s para ver um convite/partida encontrada.
- **Matchmaking sem critério** (ordem de chegada; sem MMR/faixa, sem preencher com bot após espera). Se um dos pareados nunca entrar na sala (fechou a aba), o outro fica em "Aguardando o adversário" até sair (não há prazo para o assento reservado).
- **Abandono:** sair no meio (fechar a aba) não é derrota; a vaga fica reservada (90 s) e a sala sem humanos é encerrada após 10 min sem recompensa (a partida fica `active` e fora do histórico). Use "desistir".
- **Aparência:** tinta/brilho sobre os mesmos GLBs (modelos sem variações nem esqueleto — lacuna de arte da Fase 4). O nome e os cosméticos do adversário aparecem no painel/arena; o id do personagem na ordem de iniciativa ainda revela a classe (lacuna da Fase 3).
- **Bots:** heurísticos (pesos em `WEIGHTS`, sem aprendizado); o difícil olha só o próprio turno + uma estimativa da resposta (não faz busca adversarial completa) e erra ocasionalmente contra inimigos ocultos (comandos recusados pelo servidor, < 3 % nos testes). Balanceamento dos pesos fica para a Fase 6. O personagem do bot não tem nome/cosméticos próprios além de "Bot fácil/normal/difícil".
- **Segurança de desenvolvimento:** sem HTTPS, sem limite de tentativas de login, sem recuperação de senha nem troca de senha; token no `localStorage`.
- **Escopo 1 × 1** no ciclo (o 2 × 2 da Fase 4 continua no modo local e no lobby de desenvolvimento).
- Não testado com um PostgreSQL de verdade (`DATABASE_URL`), só PGlite (lacuna da Fase 3).
