# Fase 7 — Teste externo do MVP

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): **descobrir se o jogo é divertido, compreensível e tem potencial para evolução** — distribuição para um grupo controlado, coleta de métricas, feedback dos usuários, duração das partidas, vitória por classe, uso de habilidades e de interações ambientais, abandono, revanche, problemas de interface e de câmera, percepção de equilíbrio e avaliação dos bots.

**Critério de aprovação:** "decidir, com base em dados e feedback, se o projeto deve avançar para beta e expansão de conteúdo" — **⏳ PENDENTE.** Ele só pode ser cumprido com pessoas reais jogando. Esta fase entrega **tudo o que é preciso para rodar o teste** (build de distribuição, convites, consentimento, telemetria, pesquisa, "reportar bug", revanche, painel e relatório de métricas, roteiro e modelo de decisão) e a **validação local com jogadores simulados** — que prova que a coleta e o cálculo funcionam, mas **não** diz nada sobre diversão. Ver [Checklist](#checklist-seção-15-fase-7).

Sumário: [Como rodar o teste externo](#como-rodar-o-teste-externo) · [Distribuição (LAN, túnel, hospedagem)](#distribuição-lan-túnel-hospedagem) · [Guia do testador](#guia-do-testador) · [Privacidade](#privacidade-e-consentimento) · [Roteiro e sessões](#roteiro-do-teste-e-plano-de-sessões) · [Métricas](#definições-das-métricas) · [Modelo de decisão](#modelo-de-decisão-gono-go-para-o-beta) · [O que mudou](#o-que-mudou-arquivos) · [Decisões](#decisões-tomadas-sem-consulta-revisar-se-necessário) · [Validação](#validação) · [Checklist](#checklist-seção-15-fase-7) · [Lacunas](#lacunas-conhecidas)

## Como rodar o teste externo

Para quem organiza o teste (a máquina que vai hospedar o jogo durante o período do teste):

```bash
npm install
copy .env.example .env      # (Git Bash: cp .env.example .env) — troque ADMIN_TOKEN e INVITE_CODES
npm run start:prod          # ou dois cliques em start-playtest.cmd (Windows)
```

`npm run start:prod` (`tools/playtest/start.ts`) lê o `.env`, **força produção** (`NODE_ENV=production`, `GAME_DEV=0`: sem `/debug/*`, sem as contas `jogador-a`/`jogador-b`, sem semente/turno escolhidos pelo cliente), gera o build do cliente (`vite build`, ~1 min) se ele não existir ou for de outro commit, e sobe **um único endereço** (padrão `http://<esta-máquina>:2567/`) com o jogo, a API, o WebSocket e o painel. Ele mostra os endereços da rede local e, se não houver `ADMIN_TOKEN`, o token gerado para aquela execução.

| Comando | O que faz |
|---|---|
| `npm run start:prod` · `start-playtest.cmd` | sobe o teste externo (acima). `--build` refaz o cliente; `--no-build` usa o que houver |
| `npm run build:web` | só o build de produção do cliente (`apps/web/dist`, ~18 MB sem a arte-fonte) |
| `npm run playtest:invites -- --count 10 --uses 1 --label "grupo 1"` | gera códigos de convite (servidor no ar: pela API `/admin`; parado: direto no banco). `--list` lista |
| `http://<servidor>:2567/admin` | **painel**: token → relatório ao vivo, gerar/listar convites, bugs (baixar o anexo da partida), pesquisas em CSV, relatório .md/.html |
| `npm run metrics:report [-- --since 2026-11-10 --until 2026-11-24]` | relatório Markdown + HTML em `.data/reports/` (servidor no ar: pela API com o `ADMIN_TOKEN`; parado: lê `.data/playtest`) |
| `npm run regression:from-match -- --file bug.json` | (Fase 6) o anexo de um bug baixado no painel → cenário de regressão no Combat Debug Lab |
| `npm run playtest:sim [-- --players 16]` | simulação local de um teste externo inteiro → [docs/playtest-simulado.md](playtest-simulado.md) |
| `npm run e2e:playtest` | e2e do **build de produção** no Chrome headless (abaixo) |

Variáveis novas (todas em [.env.example](../.env.example)): `ADMIN_TOKEN`, `REGISTRATION` (`invite` padrão em produção · `open` · `closed`), `INVITE_CODES` (`CODIGO:usos,…`), `PLAYTEST` (consentimento/telemetria/pesquisa/bug; padrão ligado em produção e desligado em desenvolvimento), `STATIC_DIR` (`none` desliga o cliente estático), `TRUST_PROXY=1` (IP pelo `X-Forwarded-For` atrás de túnel), `BUILD_COMMIT`. Os dados do teste ficam em `DATA_DIR=.data/playtest` (separado do `.data/pg` de desenvolvimento; ignorado pelo git).

**Durante o teste:** acompanhe o painel `/admin` (atualiza sob demanda) e os bugs; um bug com anexo vira teste de regressão (`regression:from-match`). Reiniciar o servidor encerra as partidas em andamento como `aborted` (Fase 6) — evite no horário das sessões. **Depois:** pare o servidor, rode `npm run metrics:report`, preencha o [modelo de decisão](#modelo-de-decisão-gono-go-para-o-beta), faça backup de `.data/playtest` e apague-o quando os dados não forem mais necessários (prometido na nota de privacidade).

## Distribuição (LAN, túnel, hospedagem)

Nada disto foi executado nesta fase (sem publicação na internet): são as opções documentadas. Em todas, o testador só abre **um endereço** — o cliente de produção fala com o servidor pela mesma origem (`location.origin`), e em HTTPS o WebSocket vira `wss://` sozinho.

| Opção | Como | Quando usar | Cuidados |
|---|---|---|---|
| **Rede local (LAN)** | `HOST=0.0.0.0` (padrão do `.env.example`); os testadores abrem `http://<IP-da-máquina>:2567/` (o `start:prod` mostra o IP). Libere a porta no Firewall do Windows (o próprio Windows pergunta na primeira execução) | sessões presenciais (mesma casa/escritório/LAN party) | só HTTP (sem TLS) — aceitável numa rede confiável |
| **Rede privada (Tailscale / ZeroTier)** | cada testador entra na rede privada; endereço `http://<nome-da-máquina>:2567/` | grupo remoto pequeno e de confiança (**recomendado** para remoto: nada fica público) | cada testador instala o cliente da VPN |
| **Túnel HTTPS** (Cloudflare Tunnel, ngrok) | `HOST=127.0.0.1`, `TRUST_PROXY=1`; ex.: `cloudflared tunnel --url http://127.0.0.1:2567` → um endereço `https://….trycloudflare.com` | grupo remoto sem instalar nada | o endereço fica público: o **código de convite** é a barreira (cadastro `invite`); `TRUST_PROXY=1` para os limites de login/cadastro valerem por pessoa; o túnel precisa repassar WebSocket (os dois repassam) |
| **Hospedagem (VPS)** | Node 22+ e o repositório na máquina, `npm run start:prod` atrás de um proxy com TLS (Caddy/nginx) com `TRUST_PROXY=1`; opcional `DATABASE_URL=postgres://…` | teste mais longo / mais gente | o driver `pg` nunca foi testado com um PostgreSQL de verdade (lacuna das Fases 3–6); um processo aguenta ~50 partidas contra bot simultâneas (Fase 6) |

## Guia do testador

> Texto para mandar aos testadores junto com o endereço e o código de convite.

**Bardurinho RPG — teste fechado.** Obrigado por ajudar! É um jogo tático por turnos numa arena 3D: você controla um personagem (Guerreiro, Mago, Ladino ou Druida) contra um bot ou outra pessoa.

1. Abra o endereço que recebemos (Chrome, Edge ou Firefox no computador; tela de 1280 × 720 ou maior).
2. Leia a tela de **privacidade** e escolha se quer ajudar com a telemetria (dá para jogar sem).
3. **Criar conta** → usuário, senha e o **código de convite** que você recebeu. Crie seu personagem.
4. Comece com **Jogar contra o bot (Fácil)**. Na partida: **1–9** escolhem a ação, clique na célula/alvo, **Enter** encerra o turno, **Esc** cancela a mira, **WASD/setas** movem a câmera, **Q/E** giram, roda do mouse dá zoom, **PgUp/PgDn** trocam de andar, **H** mostra a ajuda. Cada turno tem 60 s.
5. No fim da partida: **Revanche**, **Ver recompensas** ou **Voltar ao lobby** — antes de sair aparece uma **pesquisa de 30 segundos**; responda sempre que puder (pode pular).
6. Viu algo estranho? **"reportar bug"** (no painel da partida, no resultado ou no rodapé do lobby): conte o que fez e o que aconteceu — o registro da partida vai junto.
7. Depois de algumas partidas contra o bot, experimente **Procurar partida** (online) ou **Convidar um amigo** (pelo código de amigo do lobby).
8. Volte nos próximos dias se tiver vontade — **não é obrigatório**; queremos saber se você voltaria por conta própria.

Sair no meio da partida (fechar a aba) por mais de 90 s conta como derrota. A versão do jogo aparece no canto da tela — cite-a se mandar algum comentário por fora.

## Privacidade e consentimento

A primeira tela (antes do login) explica o que é coletado e pede uma escolha — **Aceitar e participar** ou **Jogar sem telemetria**; dá para mudar depois em "privacidade" no rodapé. O texto completo está em `apps/web/src/screens/flow/playtest.ts` (`PRIVACY_TEXT`). Resumo:

- **Sempre registrado** (é como o jogo funciona desde a Fase 3; servidor autoritativo): conta (usuário, senha em scrypt), personagens, partidas, comandos, eventos, resultados, moedas. As métricas usam esses dados **agregados**.
- **Só com consentimento — telemetria do cliente:** telas vistas, tempo de sessão e por turno, contagem de cancelamentos de mira, ações indisponíveis, comandos recusados, uso da câmera (girar/zoom/mover/arrastar/focar/andar/visão geral), ajuda/opções, cliques em revanche, saídas no meio da partida, erros de JavaScript (mensagem com até 64 caracteres). Vai com um **id aleatório do navegador** (criado só ao aceitar; recusar o apaga) e um id de sessão da aba, **só para o servidor do teste** (`POST /telemetry/events`; o servidor recusa lote sem `consent: true`). Nada do que é digitado, nem posição do mouse.
- **Voluntário:** pesquisa pós-partida e "reportar bug" (com o relatório da partida da Fase 6 — estado oficial e comandos — guardado só no servidor; o bug também leva tamanho da tela e o navegador).
- **Anonimização:** as tabelas de análise (`analytics_events`, `feedback_surveys`, `bug_reports`) não têm usuário, nome, IP, token nem id da conta — só o `analytics_id` (UUID aleatório da conta, sem relação com o id). O IP só é usado em memória para os limites de tentativas e **não é gravado**. O relatório mostra no máximo prefixos de id e os comentários livres (que podem conter o que a pessoa escreveu).
- **Retenção:** os dados ficam na máquina de quem organiza (`.data/playtest`), nada é enviado a terceiros; apagar a pasta ao fim do teste. Pedido de exclusão de um testador: apagar a conta (`DELETE FROM accounts WHERE username = …` remove sessões/personagens/inventário; para as análises, apagar as linhas com o `analytics_id` dela).

## Roteiro do teste e plano de sessões

**Grupo:** 12–30 pessoas (o mínimo para os critérios de decisão valerem é ~10 respostas de pesquisa e ~20 partidas por métrica), misturando quem joga táticos (XCOM, Divinity, Into the Breach), quem joga RPG em geral e quem quase não joga. **Período:** 2 semanas (para medir D1 e D7). **Convites:** um código por pessoa (`--uses 1`) para contar quem entrou; ou um código por grupo/sessão (`--uses 10 --label "sessão 1"`) para comparar grupos no relatório (código usado aparece por jogador em "Códigos de convite usados").

| Sessão | Quando | Duração | Roteiro | O que observar |
|---|---|---|---|---|
| **0 — preparação** | D−2 | — | `start:prod` no ambiente escolhido; `npm run e2e:playtest` na máquina; gerar convites; mandar o guia | o endereço abre de fora da máquina? |
| **1 — primeiro contato** | D0 | 30–40 min | sem explicar nada além do guia: cadastro → personagem → 2 partidas contra o bot fácil → 1 contra o normal | tempo até a 1ª ação, cancelamentos de mira, ajuda aberta, abandono, notas de clareza/câmera |
| **2 — PvP** | D1–D3 | 30 min | em duplas (horário marcado): fila ou convite por código de amigo; 2–3 partidas + revanche | taxa de revanche PvP, vitória por classe, equilíbrio percebido |
| **3 — livre** | D1–D13 | — | ninguém pede nada: quem quiser volta | **retorno D1/D7**, partidas por jogador, bot difícil |
| **Observação (opcional)** | D0–D3 | 20 min × 3–5 pessoas | compartilhando a tela, "pensando em voz alta" | onde trava, o que não entende (anotar à mão) |
| **Fechamento** | D14 | 10 min | perguntas abertas (abaixo); `metrics:report`; reunião de decisão | — |

Perguntas de fechamento (formulário ou conversa): o que foi mais divertido? o que mais atrapalhou? você jogaria uma versão maior (mais mapas/classes)? quanto tempo por partida seria ideal? jogaria mais contra bots ou contra pessoas? alguma classe pareceu injusta?

## Definições das métricas

Todas calculadas por `apps/server/src/modules/analytics/playtestMetrics.ts` (o mesmo código no painel, no `metrics:report` e na simulação). Partidas personalizadas (`custom`, lobby de desenvolvimento) ficam de fora; contas de bot e de desenvolvimento não contam como jogadores. Janela opcional `--since/--until` (data de criação da partida/conta/evento).

| Métrica (plano) | Definição | Fonte |
|---|---|---|
| **Duração média da partida** | `finished_at − started_at` das partidas terminadas (média, mediana, p90) | `matches` (oficial) |
| **Tempo médio por turno** | por turno de jogador: horário do último comando aceito do turno − o do fim do turno anterior (ou do START_MATCH); turnos do bot à parte; turnos encerrados só pelo cronômetro contam (jogador ausente). Também o tempo medido no cliente (início → fim da vez) | `match_commands` (oficial) · `match_ui` (telemetria) |
| **Classe mais utilizada** | assentos de jogadores por classe do personagem | `match_players.character` |
| **Taxa de vitória por classe** | vitórias ÷ partidas terminadas da classe — de jogadores, de **todos os participantes** (inclui bots; é a usada no critério), e só PvP | `match_players` + `matches.result` |
| **Habilidade mais / menos utilizada** | `USE_ABILITY` aceitos de jogadores por habilidade; "menos" = menor uso por partida em que a classe dona apareceu (entre classes jogadas). Também armas (`BASIC_ATTACK`) e consumíveis | `match_commands` |
| **Explosões e interações ambientais** | `EXPLOSION`; interações = `INTERACT` (portas) + objetos destruídos + reações (óleo + fogo, gelo apaga fogo…) + objetos incendiados — de todos os participantes; por partida terminada | `match_events` (oficial) |
| **Taxa de abandono** | (derrotas por abandono — comando `server:forfeit:*` quando alguém sai e não volta em 90 s — + partidas iniciadas abandonadas pelos dois lados) ÷ partidas iniciadas. Desistência voluntária (botão) e partidas canceladas antes de começar aparecem à parte | `match_commands`, `matches.status` |
| **Taxa de revanche** | partidas terminadas que têm uma partida nova com `rematch_of` apontando para elas ÷ partidas terminadas (por modo); cliques em "Revanche" à parte (no PvP o outro pode recusar) | `matches.rematch_of` · `rematch_click` |
| **Partidas contra bot** | por dificuldade: partidas, terminadas, vitória do jogador, duração, rodadas e a dificuldade percebida na pesquisa | `matches` + `feedback_surveys` |
| **Retorno de jogadores** | **D1** = ativo no dia (UTC) seguinte ao cadastro; **D7** = ativo no 7º dia; "em até 7 dias" = qualquer dia de 1 a 7. Só entram contas cujo dia já chegou. Ativo = abriu o jogo logado (`GET /me`) ou entrou numa partida | `account_days`, `match_players` |
| Interface e câmera | por partida (resumo do cliente): miras canceladas (Esc), ações indisponíveis clicadas, comandos recusados (+ recusas por código no servidor), câmera (girar, zoom, mover, arrastar, focar), trocas de andar, visão geral, ajuda, opções | `match_ui` (telemetria) · `match_commands` |
| Sessões | id de sessão da aba; duração = último − primeiro evento (há um "heartbeat" a cada 60 s com a aba visível); telas vistas; erros de cliente | `analytics_events` |
| Pesquisa | diversão, clareza, câmera (1–5), equilíbrio percebido (−2…+2), dificuldade do bot (1 muito fácil … 3 na medida … 5 muito difícil), jogaria de novo (sim/talvez/não), comentário; por modo e por classe; abertas × puladas | `feedback_surveys` · `survey_open/skip` |
| Bugs | por categoria, com/sem o relatório da partida | `bug_reports` |

## Modelo de decisão (go/no-go para o beta)

Os critérios quantitativos são calculados automaticamente (primeira seção do relatório; `GO_NO_GO` em `playtestMetrics.ts`). Cada um tem uma **amostra mínima**: abaixo dela aparece "sem dados" e não conta.

| Critério | Alvo | Amostra mínima | Por quê |
|---|---|---|---|
| Diversão média | ≥ 3,5 / 5 | 10 respostas | pergunta principal da fase |
| "Jogaria de novo" (sim + talvez) | ≥ 70 % | 10 | intenção de voltar |
| Clareza média | ≥ 3,5 | 10 | "compreensível" (objetivo da fase) |
| Câmera média | ≥ 3,5 | 10 | risco conhecido de jogos táticos 3D |
| Taxa de abandono | ≤ 15 % | 20 iniciadas | frustração / partidas longas |
| Taxa de revanche | ≥ 20 % | 20 terminadas | vontade de jogar de novo na hora |
| Retorno D1 | ≥ 30 % | 8 contas elegíveis | potencial de retenção |
| Retorno D7 | ≥ 15 % | 8 | idem (teste curto e sem conteúdo novo: referência baixa) |
| Duração média da partida | 5–20 min | 20 terminadas | ritmo |
| Vitória por classe (todos os participantes) | todas entre 40–60 % | 20 jogos por classe | equilíbrio |
| Bot normal "na medida" | média 2,5–3,5 | 5 respostas | avaliação dos bots |
| Erros de cliente por sessão | ≤ 0,1 | 20 sessões | estabilidade |

**Critérios qualitativos (decididos na reunião, não pelo relatório):** nenhum bug **crítico** aberto (divergência de estado, vazamento de informação oculta, travamento que impede terminar a partida, perda de progresso); os comentários não apontam um problema estrutural (ex.: "não entendi o jogo" recorrente); a observação das sessões não mostrou bloqueios que as métricas não captam.

**Regra de decisão sugerida:**

- **Avançar para o beta e expansão de conteúdo:** ≥ 9 dos 12 critérios "ok" (com amostra), incluindo diversão e "jogaria de novo", e nenhum bug crítico.
- **Avançar com ajustes** (uma iteração curta antes do beta): diversão ok, mas 3–5 critérios em "atenção" (tipicamente clareza, câmera, equilíbrio ou bots) — corrigir e repetir um teste menor.
- **Iterar o MVP:** diversão < 3,5 **ou** "jogaria de novo" < 70 % **ou** abandono > 25 % — rever o núcleo (ritmo, regras, câmera) antes de produzir conteúdo.
- **Parar / repensar:** diversão < 2,5 com amostra cheia e comentários negativos consistentes.

**Modelo para preencher (copiar para a ata):**

```text
Teste externo — período: ____ a ____   build(s): ________   participantes: __ (convites usados __/__)
Partidas: __ (bot __ / PvP __)   respostas de pesquisa: __   bugs: __ (críticos: __)
Critérios ok: __/12   atenção: ______________________   sem dados: ______________________
Três pontos mais citados nos comentários: 1) ____ 2) ____ 3) ____
Observação das sessões: ______________________________________________
Decisão: [ ] beta e expansão  [ ] ajustes e novo teste  [ ] iterar o MVP  [ ] parar
Próximos passos (responsável, prazo): __________________________________
```

## O que mudou (arquivos)

```text
apps/server/
  migrations/003_playtest.sql            NOVO — invite_codes; accounts.analytics_id/invite_code/telemetry_consent; matches.rematch_of;
                                         analytics_events; feedback_surveys; bug_reports; account_days (retorno D1/D7)
  src/db/playtest.ts                     NOVO — convites (consumo na transação do cadastro), telemetria, pesquisa, bugs, dia ativo
  src/modules/analytics/playtestMetrics.ts NOVO — todas as métricas + go/no-go + relatório Markdown/HTML
  src/adminRoutes.ts                     NOVO — /admin (painel) e /admin/api/* (token, tempo constante)
  src/build.ts                           NOVO — versão do servidor (package.json + commit)
  src/http.ts                            /playtest/config, /telemetry/events|consent, /feedback/survey|bug, /lobby/rematch;
                                         cadastro com convite; /me marca o dia ativo; cliente estático (+ gzip em memória); TRUST_PROXY
  src/config.ts · app.ts · services.ts   PLAYTEST, REGISTRATION, INVITE_CODES, ADMIN_TOKEN, STATIC_DIR, TRUST_PROXY; logs de inicialização
  src/db/accounts.ts                     register(…, { code, required }) + InviteCodeError
  src/modules/lobby/LobbyService.ts      rematch(): bot na hora; PvP = convite com rematchOf (os dois pedem → partida)
  src/modules/matches/MatchSession.ts · adapters/colyseus/MatchRoom.ts · db/repositories.ts   rematchOf até matches.rematch_of
packages/protocol/src/playtest.ts        NOVO — contrato das rotas, validação/saneamento dos eventos de telemetria, BuildInfo
packages/protocol/src/api.ts             InviteDto.rematchOf
apps/web/
  vite.config.ts                         versão do build (__BUILD_INFO__ + build.json); arte-fonte (models/source) fora do dist
  src/build.ts                           NOVO — BUILD, BUILD_LABEL, IS_PROD
  src/telemetry/telemetry.ts             NOVO — telemetria com consentimento (fila, lotes, sendBeacon) + MatchTracker por partida
  src/screens/flow/playtest.ts           NOVO — privacidade/consentimento, pesquisa pós-partida, reportar bug
  src/screens/flow/gameFlow.ts           consentimento, código de convite, rodapé (versão/privacidade/bug), Revanche (bot/PvP),
                                         pesquisa antes de sair do resultado, telemetria da partida
  src/screens/arenaScreen.ts · networkHud.ts   sinais de atrito (telemetria) e "reportar bug" no painel da partida
  src/network/connect.ts · api.ts        build de produção = mesma origem; métodos novos da API
  src/main.ts · style.css                versão no canto da tela; estilos das telas novas
tools/playtest/start.ts · report.ts · invites.ts · simulate.ts   NOVOS — start:prod, metrics:report, playtest:invites, playtest:sim
tools/e2e/playtest.ts · uiDriver.ts      NOVOS — e2e do build de produção (driver da aba extraído do e2e:ciclo)
tests/integration/playtest.test.ts       NOVO — 8 testes (abaixo)
.env.example · start-playtest.cmd        NOVOS — configuração e atalho do Windows; .env no .gitignore
package.json                             versão 0.7.0; scripts start:prod, build:web, metrics:report, playtest:*, e2e:playtest
docs/fase-07.md · docs/playtest-simulado.md · docs/screenshots/fase-07/
```

## Decisões (tomadas sem consulta; revisar se necessário)

1. **Um endereço só:** o servidor de jogo serve o build de produção do cliente (Express estático do próprio transporte do Colyseus) e o cliente de produção usa `location.origin` como servidor. Assim LAN, túnel e hospedagem funcionam sem configurar CORS nem portas extras. O JS (~8 MB) é comprimido com gzip uma vez em memória; os GLBs já vêm comprimidos (meshopt). A arte-fonte (`assets/models/source`, ~60 MB) sai do `dist`.
2. **Servidor roda com `tsx`** também em produção (sem passo de compilação do servidor): é o que já funciona em todas as fases e o teste é pequeno; compilar para JS fica para o beta.
3. **Grupo controlado por código de convite** (padrão em produção: `REGISTRATION=invite`), consumido na mesma transação do cadastro (código esgotado/errado desfaz tudo). Códigos pelo `.env`, pelo painel ou pelo `playtest:invites`. Sem lista de usuários permitidos: o código é a lista.
4. **Consentimento só para a telemetria do cliente.** Os dados oficiais das partidas já são gravados desde a Fase 3 (servidor autoritativo, histórico, recompensas) e entram agregados nas métricas sem consentimento extra — isso está dito na tela de privacidade. Pesquisa e bug são voluntários. Recusar não muda nada no jogo.
5. **Anonimização por `analytics_id`** (UUID aleatório por conta, criado pela migração) em vez de hash do id: não dá para voltar à conta sem a tabela `accounts`. IP nunca é gravado.
6. **Telemetria agregada por partida** (um `match_ui` com contagens no fim, ou ao sair) em vez de um evento por clique: pouco volume, nada de posição do mouse. "Cancelamento" = Esc com mira ativa (o clique direito que também cancela não é contado); "misclick" = ação indisponível clicada + comando recusado (o clique numa célula inválida da mira é recusado pelo core e conta como recusado). Não existe "desfazer" no jogo (seção 5: comandos são definitivos), então não há métrica de desfazer.
7. **Sessão = aba** (`sessionStorage`), porque o jogo recarrega a página a cada volta ao lobby; duração pela diferença entre o primeiro e o último evento + heartbeat de 60 s.
8. **Revanche:** contra o bot cria a partida na hora (mesma dificuldade, personagem ativo, bot sorteado de novo); no PvP é um **convite marcado com `rematchOf`** — se os dois pedem, ou o outro aceita o convite (também visível no lobby como "Pedido de revanche"), a partida nasce no mesmo modo. Entrar = recarregar a página (o lobby entrega a partida montada), como "Voltar ao lobby". A taxa de revanche conta partidas que realmente aconteceram (`matches.rematch_of`).
9. **Pesquisa aparece ao sair do resultado** ("Revanche", "Voltar ao lobby", ou na tela de recompensas), uma vez por partida, com "Pular". Só diversão é obrigatória para enviar. Equilíbrio em escala −2…+2 ("contra mim" … "a meu favor") e dificuldade do bot em 1…5 com 3 = "na medida".
10. **"Reportar bug" anexa no servidor** o relatório da Fase 6 (estado inicial com a semente + comandos) — só se a conta jogou a partida; o anexo nunca volta para o cliente (tem a semente e o estado completo) e é baixado só pelo painel.
11. **Painel sem cookies:** a página `/admin` é só HTML; o token vai no cabeçalho `Authorization` das chamadas e fica no `sessionStorage` da aba. Sem `ADMIN_TOKEN` em produção, um token aleatório é gerado e mostrado no log a cada execução.
12. **Critérios de go/no-go com números iniciais** (tabela acima) escolhidos como referência razoável para um MVP tático de nicho; são para orientar a conversa, não substituí-la — ajuste antes de começar o teste se quiser outros alvos.
13. **Simulação com dias simulados:** cada "dia" roda em segundos e os horários são recuados no banco depois (0 → 7 dias atrás); ritmo de decisão acelerado. Bom para validar a coleta e o cálculo; os números do relatório simulado não valem como resultado.
14. **Versão 0.7.0** no `package.json` da raiz (= Fase 7); a versão mostrada é `v0.7.0 · <commit>` (cliente: do build; servidor: na inicialização).

## Validação

Rodado nesta máquina (Windows 11, Node 26, Chrome headless com SwiftShader), 04/11/2026.

| Verificação | Resultado |
|---|---|
| `npx tsc -b` | limpo |
| `npx vitest run` | **313 testes** passando (26 arquivos; eram 305) |
| `npm run e2e:playtest` | ver abaixo |
| `npm run playtest:sim` | ver [docs/playtest-simulado.md](playtest-simulado.md) |
| e2e das fases anteriores | ver abaixo |

**`tests/integration/playtest.test.ts`** (servidor no mesmo processo em configuração de produção): sem `/debug`; `/playtest/config`; cliente estático na mesma porta com gzip e sem sair da pasta; cadastro sem código/código errado/esgotado recusado (transação desfeita, usos contados); telemetria recusada sem consentimento, tipos desconhecidos descartados, propriedades saneadas, `analytics_id` em vez de conta, nenhuma coluna de análise com usuário/nome/IP/token; pesquisa (validação, uma por partida, outra conta não responde, campos derivados no servidor: modo, dificuldade, resultado, classe) e bug com o relatório da partida anexado (e sem anexo para quem não jogou); revanche contra o bot (409 com a partida em andamento, mesma dificuldade, `rematch_of`) e PvP (pedido → convite de revanche → o outro pede → mesma sala para os dois); painel com token (401 sem/errado), métricas, relatório .md/.html com todas as métricas principais, convites pelo painel, CSV; retorno D1/D7.

**`npm run e2e:playtest`** (`tools/e2e/playtest.ts`): faz o `vite build`, sobe o servidor **pelo `start:prod`** (produção, porta 2581, PGlite em memória, `INVITE_CODES`), abre `http://127.0.0.1:2581/` num Chrome headless (`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`) e, só com entrada real: privacidade (aceitar) → cadastro com código errado (recusado) e certo → personagem → lobby com a versão → partida contra o bot fácil até o fim (roteiro decide com um `BotBrain` lendo a visão da aba) → resultado → **reportar bug** → **Revanche** → **pesquisa** → partida nova → desistir → "Voltar ao lobby" → pesquisa pulada → **painel /admin** com o token. Confere pela API de administração: pesquisa, bug com anexo = relatório da partida, revanche com `rematch_of`, telemetria (sessão, eventos, resumos de partida), pesquisa pulada, consentimento na conta; sem console com erro.

Registro (04/11/2026): **todas as conferências ok em ~126 s** (sem contar o build) — o Mago "Lyra Brasa" venceu o bot fácil por eliminação (14 turnos do jogador), bug enviado com o anexo, pesquisa (diversão 4) → revanche (partida nova com `rematch_of`) → desistência → pesquisa pulada; 23 eventos de telemetria e 2 resumos de partida no servidor; console sem erros (o único 403 é o do código de convite errado, esperado).

**`npm run playtest:sim -- --players 16`** (`tools/playtest/simulate.ts`, ~3,5 min): servidor em configuração de produção (servindo o `apps/web/dist`), 16 jogadores simulados com perfis sorteados (classe preferida, qualidade das decisões, dificuldade do bot, consentimento 85 %, chance de abandonar/desistir/pedir revanche/responder a pesquisa/reportar bug, retorno D1/D7), jogando pelo mesmo código do cliente em 4 "dias" (0, 1, 3 e 7). Registro (04/11/2026, semente 7): **74 partidas** (1 PvP pela fila — a maioria dos perfis prefere o bot e a fila só pareia quem chega junto), 5 abandonos → 5 derrotas por abandono, 22 revanches, 48 pesquisas, 2 bugs com anexo, D1 6/16, D7 2/16; o relatório confere cada contagem com o que a simulação fez (jogadores, partidas, pesquisas, bugs, revanches, abandonos, D1/D7, sessões e resumos de interface, duração/turno) — **todas ok**. Relatório completo (marcado DADOS SIMULADOS): [docs/playtest-simulado.md](playtest-simulado.md); HTML e JSON em `tests/output/playtest-sim/`.

| Captura | O quê |
|---|---|
| [01-consentimento](screenshots/fase-07/01-consentimento.png) | primeira visita: privacidade e escolha da telemetria |
| [02-cadastro-convite](screenshots/fase-07/02-cadastro-convite.png) | cadastro com código de convite (depois de um código errado) |
| [03-lobby](screenshots/fase-07/03-lobby.png) | lobby com a versão do build, "privacidade" e "reportar bug" |
| [04-partida-bot](screenshots/fase-07/04-partida-bot.png) | partida contra o bot no build de produção ("reportar bug" no painel) |
| [05-resultado](screenshots/fase-07/05-resultado.png) | resultado: Ver recompensas · **Revanche** · Voltar ao lobby · Reportar bug |
| [06-reportar-bug](screenshots/fase-07/06-reportar-bug.png) | bug enviado com o registro da partida |
| [07-pesquisa](screenshots/fase-07/07-pesquisa.png) | pesquisa pós-partida preenchida |
| [08-revanche](screenshots/fase-07/08-revanche.png) | a revanche começando |
| [09-painel-admin](screenshots/fase-07/09-painel-admin.png) | painel /admin com o relatório |

## Checklist (seção 15, Fase 7)

| Item | Status |
|---|---|
| Distribuição para grupo controlado | ✅ build de produção num endereço só (`start:prod` / `start-playtest.cmd`), convites, opções de LAN/rede privada/túnel/hospedagem documentadas. ⏳ distribuição real não feita (sem testadores; nada publicado) |
| Coleta de métricas | ✅ dados oficiais + telemetria com consentimento + migração 003; painel e `metrics:report`. Validado com jogadores simulados |
| Feedback dos usuários | ✅ pesquisa pós-partida, "reportar bug" com o registro da partida, perguntas de fechamento no roteiro. ⏳ nenhum feedback real ainda |
| Duração das partidas · tempo por turno | ✅ calculados (servidor + cliente) |
| Taxa de vitória por classe | ✅ jogadores / todos / PvP |
| Uso das habilidades · habilidade mais/menos usada | ✅ (+ armas e consumíveis) |
| Uso das interações ambientais · explosões | ✅ explosões, portas, objetos destruídos/incendiados, reações, superfícies |
| Taxa de abandono | ✅ derrota por abandono + abandonadas; desistência e cancelamento à parte; saídas vistas pelo cliente |
| Revanche | ✅ **recurso novo** (bot e PvP) + taxa de revanche |
| Problemas de interface · de câmera | ✅ sinais de atrito por partida + notas de clareza/câmera + bugs por categoria. ⚠️ indiretos: a observação das sessões continua necessária |
| Percepção de equilíbrio | ✅ pergunta da pesquisa + vitória por classe |
| Avaliação dos bots | ✅ dificuldade percebida por nível + vitória dos jogadores por nível |
| Partidas contra bot · retorno de jogadores (D1/D7) | ✅ |
| Roteiro, guia do testador, privacidade, modelo de decisão | ✅ (acima) |
| **Critério de aprovação** | ⏳ **pendente** — precisa do teste com pessoas reais; o relatório simulado não serve para decidir |

## Lacunas conhecidas

- **O teste em si não aconteceu.** Nada sobre diversão, clareza ou retenção é conhecido; os números de [playtest-simulado.md](playtest-simulado.md) são de robôs com ritmo acelerado.
- **Nenhuma opção de distribuição foi exercitada de fora desta máquina** (LAN com outro computador, túnel, VPS): só `127.0.0.1`. O Firewall do Windows, o túnel e o TLS ficam para a sessão 0 do roteiro.
- **PostgreSQL de verdade** (`DATABASE_URL`) continua não testado (lacuna das Fases 3–6); para um teste pequeno o PGlite em disco basta.
- **Telemetria de câmera/interface é contagem**, não "problema": muito zoom pode ser gosto, não atrito. Cliques numa célula inválida aparecem como "comando recusado"; o clique direito que cancela a mira não é contado.
- **D1/D7 por dia UTC**: um testador do Brasil que joga às 22h e de novo às 8h conta como D1. Com poucos testadores, D7 é muito ruidoso.
- **Sessão/abandono no cliente:** recarregar a página no meio da partida também gera um `match_leave` (`pagehide`) — por isso a taxa de abandono oficial usa só os dados do servidor.
- **Comentários livres** aparecem no relatório como escritos (podem ter nomes ou dados pessoais que o próprio testador digitou).
- **Painel simples:** sem gráficos, sem paginação (bugs: 200 mais recentes; comentários: 60), sem apagar dados pela interface; atualização manual.
- **Bundle grande** (~8 MB de JS, ~1,8 MB com gzip) e GLBs de ~2 MB: primeira carga lenta num túnel/conexão fraca (lacuna de desempenho da Fase 6).
- **Servidor sem compilação** (tsx) e sem gerenciador de processo: se a máquina dormir ou o processo cair, o teste para (reiniciar com `start-playtest.cmd`; partidas em andamento viram `aborted`).
- **Pedido de exclusão de dados** é manual (SQL), sem tela.
