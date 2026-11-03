# Fase 3 — Multiplayer local

Objetivo (seção 15 do [plano](plano_mvp_rpg_tatico.md)): provar a arquitetura cliente-servidor autoritativa. **Critério de aprovação:** dois clientes locais completam uma partida sem divergência de estado e sem o cliente controlar resultados oficiais — **atendido** (`npm run e2e:rede` e `npm run e2e:rede-ui`, ver "Critério de aprovação").

## Como rodar

```bash
npm install
npm run server        # servidor de jogo em http://127.0.0.1:2567 (WebSocket + HTTP), banco PGlite em .data/pg
npm run web           # cliente 3D em http://127.0.0.1:5173
npm run lab           # Combat Debug Lab em http://127.0.0.1:5174 → botão "NETWORK ↗" (/network.html)
```

Partida em rede: abra **duas abas** (ou dois navegadores) em `http://127.0.0.1:5173/?mode=rede`, entre como **Jogador A** numa e **Jogador B** na outra (contas de desenvolvimento `jogador-a` / `jogador-b`, senha `dev`) e clique em **Procurar partida** nas duas (a primeira cria a sala, a segunda entra nela; ou escolha a sala na lista). Com os dois assentos ocupados o servidor inicia a partida. Sem `?mode=rede` o cliente continua na partida local da Fase 2 (`npm run e2e:partida` continua passando).

Parâmetros do modo rede: `server=http://host:porta`, e só com o servidor em modo dev (padrão fora de produção) `seed=N` (semente dos dados) e `turn=S` (duração do turno) para quem cria a sala. Recarregar a página volta à mesma partida.

| Comando | O que faz |
|---|---|
| `npm run server` | `apps/server` (tsx). Variáveis: `PORT` (2567), `HOST` (127.0.0.1), `DATA_DIR` (`.data/pg`; `memory` = em memória), `DATABASE_URL` (PostgreSQL externo), `TURN_SECONDS` (60), `RECONNECT_SECONDS` (90), `ABANDON_SECONDS` (600), `GAME_DEV=0` (desliga `/debug` e opções de dev), `GAME_LOG=0` |
| `npm run e2e:rede` | Critério de aprovação, sem navegador: sobe um servidor próprio (porta 2568, PGlite novo em `tests/output/e2e-rede/pg`), dois clientes Node jogam até a vitória e tudo é conferido (abaixo). `E2E_SEED=N` troca a semente |
| `npm run e2e:rede-ui` | O mesmo pela interface: dois Chrome headless jogam pelo cliente 3D com entrada real (precisa do `npm run web`; servidor próprio na porta 2569). Gera as capturas de `docs/screenshots/fase-03/` |
| `npm test` | inclui `tests/integration/server.test.ts` (servidor no mesmo processo, PGlite em memória) e `tests/unit/projection.test.ts` |

## Arquitetura

```text
apps/server/                         monólito modular (seção 9)
  migrations/001_init.sql            contas, sessões, partidas, jogadores, comandos, eventos, snapshots, resultados
  src/main.ts · app.ts               montagem: banco → migrações → contas dev → Colyseus (ws) → rotas HTTP
  src/config.ts                      variáveis de ambiente
  src/db/database.ts                 PGlite (padrão) ou pg (DATABASE_URL) atrás da mesma interface
  src/db/migrations.ts               aplica migrations/*.sql em ordem (schema_migrations)
  src/db/repositories.ts             AccountsRepository (scrypt + tokens de sessão), MatchesRepository
  src/modules/matches/MatchSession.ts partida autoritativa SEM Colyseus: fila, validação, persistência,
                                     projeção por equipe, cronômetro, proteção contra repetição
  src/modules/matches/replay.ts      refaz a partida a partir do snapshot 0 + registro de comandos
  src/adapters/colyseus/MatchRoom.ts sala Colyseus: auth, assentos, reconexão, presença, limite de mensagens
  src/http.ts                        /health, /auth/login, /rooms, /debug/* (dev)
packages/protocol/src/index.ts       envelope (commandId, protocolVersion), mensagens cliente↔servidor,
                                     validação de formato por tipo de comando, hash estável do estado
packages/domain/src/visibility/projection.ts  projectStateForClient / projectEventsForTeam (visão individual)
apps/web/src/network/                connect.ts (login, sala, sessão salva) · NetworkMatch.ts (MatchDriver em rede)
apps/web/src/screens/lobby.ts · networkHud.ts   lobby mínimo · painel de rede (cronômetro, presença, sincronia)
apps/combat-debug-lab/network.html · src/network.ts   modo NETWORK
```

**Fluxo de um comando** (seção 11.2, `MatchSession.submit`): o cliente envia `command` = `GameplayCommand` + `{ protocolVersion, commandId }` → 1. assento autenticado da conexão → 2. formato (`parseClientCommand`: só campos conhecidos por tipo, limites de coordenadas/ids; `DEBUG_*` e `START_MATCH` recusados) → 3. `commandId` já visto → devolve a mesma resposta (`duplicate: true`), nada é reaplicado; de outro jogador → `DUPLICATE_COMMAND` → 4. o personagem é da equipe do assento (`NOT_YOUR_UNIT`) → 5–9. `applyCommand` do core **sem opções de debug** (turno, `expectedTurnId`, recursos, alcance, andar, **linha de visão**, alvo detectado, consequências) → 10. transação: comando + eventos + snapshot da nova versão (+ resultado, se acabou) → 11. só então o estado vira oficial → 12. cada assento recebe `update` com a **sua** projeção. Comandos recusados também são registrados (auditoria). Uma fila (promise chain) por partida: um comando por vez.

**Mensagens.** Servidor → cliente: `snapshot` (entrada, reconexão, ressincronização: estado projetado, versão, hash, cronômetro, assentos, histórico de eventos filtrado), `update` (um por comando aceito, de qualquer autor: versão, eventos filtrados, estado projetado, hash, cronômetro), `result` (resposta ao autor), `presence`. Cliente → servidor: `command`, `ack { version, hash }`, `resync`. Não há estado sincronizado do Colyseus (Schema): ele mandaria o mesmo estado para todos; a visão por equipe é montada pelo domínio.

**Cliente em rede** (`NetworkMatch`, mesma interface `MatchDriver` do `MatchController` local): não roda `applyCommand` para decidir nada; o estado é sempre o projetado pelo servidor. As funções do core usadas pela interface (alcance, alvos válidos, prévia, ações disponíveis) só leem esse estado para dicas. Atualizações entram numa fila: versão repetida é ignorada; lacuna de versão → `resync`. Depois de aplicar, confere o hash do estado com o do servidor e envia `ack`. A interface só deixa dar ordens a personagens da própria equipe (barra de ações, painel do alvo, Enter e cliques ficam inativos na vez do adversário, com o aviso "Vez do adversário — N s").

## Decisões (tomadas sem consulta; revisar se necessário)

1. **Colyseus 0.18** (`@colyseus/core` + `@colyseus/ws-transport`; o pacote `colyseus` completo traria auth/monitor/playground/redis sem uso) e **`@colyseus/sdk` 0.18** no cliente.
2. **PostgreSQL via PGlite** (PostgreSQL real em WASM, persistido em `.data/pg`, ignorado pelo git): a máquina não tem PostgreSQL nem Docker. Mesmo SQL e migrações; `DATABASE_URL=postgres://…` troca para o driver `pg` (implementado, **não testado aqui** por falta de servidor). PGlite tem uma conexão: consultas e transações passam por uma fila.
3. **Contas de desenvolvimento** `jogador-a`/`jogador-b` (senha `dev`, scrypt) criadas ao subir em modo dev; `POST /auth/login` devolve um token de sessão (7 dias, tabela `sessions`) usado em `joinOrCreate`/`joinById`. Sem tela de cadastro.
4. **Assento preso à conta**: primeira conta = equipe A, segunda = B (cenário fixo do Pátio das Ruínas: Guerreiro A × Mago B). Sala cheia vira privada (sai do matchmaking); terceira conta é recusada.
5. **Estado completo projetado a cada comando** (~30 KB de JSON) + eventos filtrados, em vez de deltas: simples, e o snapshot de reconexão é o mesmo formato. Otimizar fica para depois.
6. **Visão individual** (`projection.ts`): some o inimigo vivo não detectado; **semente dos dados zerada** (com ela o cliente preveria as rolagens); derrotados ficam (derrota pública, com posição); terreno/objetos/superfícies continuam públicos (MVP, seção 6.2); ordem de iniciativa e "de quem é a vez" são públicas (só ids). Eventos: só desconhecidos → descartado; misto → desconhecido vira `null` (ex.: dano num aliado vindo de atacante oculto); passos de inimigo só se o destino é visível; `COMMAND_ACCEPTED` adversário resumido a `{type, actorId}`; `cause.sourceId` desconhecido → `null`. **Partida encerrada: o estado vai inteiro** (nada mais a esconder; tela de resultado com os dois).
7. **START_MATCH é do servidor** (quando os dois assentos estão ocupados).
8. **Cronômetro**: 60 s por turno (`TURN_SECONDS`); ao esgotar o servidor aplica `END_TURN` do personagem da vez (autor `timer`, `commandId` `timer:<partida>:<turno>`). Continua com o jogador desconectado (seção 11.5). O cliente mostra a contagem pelo relógio do servidor (`serverNow` corrige a diferença).
9. **Reconexão**: queda → `allowReconnection` por 90 s (`RECONNECT_SECONDS`); o SDK reconecta sozinho e recarregar a página usa o token salvo em `sessionStorage`. Expirada a reserva, a mesma conta volta ao mesmo assento por `joinById` (sessão). Ao voltar: snapshot autorizado, cena reconstruída, câmera no personagem da vez, sem reproduzir eventos antigos (14.14). Nova conexão da mesma conta derruba a anterior. Sala sem ninguém conectado por 10 min (`ABANDON_SECONDS`) é encerrada (a partida fica no banco como `active`).
10. **Hash de divergência**: cyrb53 de JSON com chaves ordenadas (`stateHash`), igual no navegador e no Node. O servidor registra `ack` divergente por assento (aparece no Lab NETWORK).
11. **Limite de mensagens próprio** (120/s por conexão, depois desconecta): o `maxMessagesPerSecond` do Colyseus 0.18 conta pelo relógio da sala, que só anda com `setSimulationInterval` — sem simulação o contador nunca zera e a conexão caía depois de N mensagens no total (descoberto no e2e).
12. **Lab NETWORK** é uma página do Lab que lê as rotas `/debug/*` do servidor (só em modo dev) uma vez por segundo, em vez de entrar na sala como observador: não precisa de um papel "espectador" no protocolo e não arrisca mandar a visão oficial por WebSocket.

## Critério de aprovação

`npm run e2e:rede` (registro: semente 7 → vitória da equipe B por eliminação, 7 rodadas, 37 versões, ~3 s; sementes 1–5 também terminam em vitória). Dois clientes Node com o mesmo código do cliente web (`connect.ts` + `NetworkMatch`); cada robô decide só com a visão da sua equipe (anda até o inimigo ou até uma porta do muro e a abre; ataca quando há ação válida). Confere:

- tentativas de trapaça recusadas sem mudar o estado oficial: fora do turno (`WRONG_TURN`), personagem da outra equipe (`NOT_YOUR_UNIT`), campos `damage`/`result` forjados (`INVALID_FORMAT`), `DEBUG_SET_UNIT` e `START_MATCH` (`COMMAND_NOT_ALLOWED`), atacar o inimigo oculto pelo id; `commandId` repetido não é reaplicado;
- queda do B no meio da partida e reconexão com o token: snapshot = projeção oficial;
- a cada versão, hash do estado do cliente = hash do servidor; nenhum `ack` divergente;
- **toda versão**, para as duas equipes: estado e eventos recebidos = projeção recalculada a partir do estado oficial **persistido** (rota `/debug/matches/:id/versions/:v`); nenhum inimigo fora da visão no estado recebido (dezenas de envios com o inimigo oculto);
- hash final de cada cliente = projeção oficial final; resultado dos clientes = resultado oficial; `MATCH_ENDED` gerado pelo servidor;
- **replay** do registro de comandos persistido (snapshot 0 + comandos aceitos) reproduz cada snapshot e o hash final gravado em `match_results`.

`npm run e2e:rede-ui`: dois Chrome headless (perfis separados) fazem o mesmo pela interface — login e "Procurar partida" com cliques, cartas por atalho + clique na célula do canvas, porta pelo painel do alvo, Enter para encerrar o turno; a aba B é **recarregada** no meio (volta à mesma partida, estado = projeção oficial). Registro (semente 7): vitória da equipe B, 13 turnos, ~90 s, nenhum erro/aviso no console das abas.

| Captura | O quê |
|---|---|
| [01-lobby](screenshots/fase-03/01-lobby.png) | as duas abas no lobby após o login |
| [02-aguardando](screenshots/fase-03/02-aguardando.png) | A criou a sala e aguarda; B ainda no lobby |
| [03-inicio](screenshots/fase-03/03-inicio.png) | início: A vê só o Guerreiro, B só o Mago (inimigo fora da visão); cronômetro, "Vez do adversário" |
| [04-contato](screenshots/fase-03/04-contato.png) | os dois já se veem |
| [05-recarregou-b](screenshots/fase-03/05-recarregou-b.png) | B depois de recarregar a página (snapshot do servidor) |
| [06-resultado](screenshots/fase-03/06-resultado.png) | resultado decidido pelo servidor nas duas abas |
| [07-lab-network](screenshots/fase-03/07-lab-network.png) | Combat Debug Lab NETWORK: SERVER STATE × CLIENT A VIEW × CLIENT B VIEW, sincronia por hash, ocultos, checagem de vazamento, registro de comandos |

## Testes (`npm test`)

`tests/integration/server.test.ts` — servidor no mesmo processo (porta livre, PGlite em memória, clientes `@colyseus/sdk` + `NetworkMatch`):

- dois jogadores entram; o servidor inicia; cada um só tem a própria equipe; nenhum payload ao A contém o Mago nem a semente; hashes = projeção oficial; `ack` sem divergência;
- `commandId` repetido não reaplica (e não pode ser usado pelo outro jogador; um registro só no banco); fora do turno → `WRONG_TURN`; personagem alheio → `NOT_YOUR_UNIT`;
- inválidos: campo extra, `DEBUG_*`, `START_MATCH`, coordenada fora do limite, versão do protocolo, `expectedTurnId` velho, movimento impossível, alvo oculto por id — nada muda o estado; recusados ficam registrados;
- **linha de visão no servidor**: ataque à distância atrás de um muro → `NO_LINE_OF_SIGHT`; com visão → aceito;
- persistência: comandos, eventos, um snapshot por versão, jogadores, `match_results` com vencedor; replay do registro reproduz o hash final; resultado dos clientes = oficial;
- reconexão: B cai, perde versões, volta pelo token com snapshot = projeção oficial; reserva expirada → volta ao mesmo assento pela conta; terceira conta é recusada;
- cronômetro: turno de 0,4 s encerrado sozinho pelo servidor (comandos `timer` aceitos e persistidos).

`tests/unit/projection.test.ts` — projeção de estado (inimigo e semente somem; original intacto), filtragem de eventos (movimento/gasto do oculto não vazam; estrutura do turno pública; referência mista vira `null`; passo para célula invisível some), formato do protocolo e hash estável.

## Progresso

- [x] Node.js + Colyseus 0.18 + WebSocket (`apps/server`, porta 2567)
- [x] Salas (`arena`: `joinOrCreate`, `joinById`, lista em `GET /rooms`; lobby mínimo no cliente)
- [x] Duas contas (dev, scrypt, sessão por token no banco)
- [x] Turnos sincronizados (versão por comando, `update` para os dois, fila por partida)
- [x] Validação de comandos no servidor (formato por tipo + autorização + core sem debug)
- [x] `commandId` + proteção contra repetição (memória + `UNIQUE (match_id, command_id)`)
- [x] Timer do turno com `END_TURN` automático (continua com o jogador desconectado)
- [x] Reconexão (reserva de 90 s, reconexão automática do SDK, recarregar a página, volta pela conta) com snapshot
- [x] PostgreSQL local (PGlite em disco; `DATABASE_URL` para PostgreSQL externo) + migrações SQL
- [x] Persistência básica: contas, sessões, partidas, jogadores, resultados
- [x] Snapshots (um por versão; cada comando aceito salva o estado — seção 10.2)
- [x] Registro de comandos (aceitos e recusados) e de eventos oficiais
- [x] Visão individual e ocultação de informações (estado + eventos + semente) montadas no servidor
- [x] Linha de visão validada no servidor (core sem opções de debug; teste dedicado)
- [x] Combat Debug Lab: modo NETWORK (estado oficial × visão de cada cliente)
- [x] Cliente 3D em modo rede (`?mode=rede`) mantendo o modo local
- [x] Critério de aprovação: `e2e:rede` e `e2e:rede-ui`
- [ ] Retomar partidas em andamento depois de reiniciar o servidor (os snapshots permitem; não implementado)
- [ ] Testar com um PostgreSQL de verdade (`DATABASE_URL`) — sem servidor disponível nesta máquina

## Lacunas conhecidas

- **Reinício do servidor** perde as salas em memória; a partida fica `active` no banco (dá para retomar a partir do último snapshot + `match_players`, ainda não feito).
- **Objetos e superfícies são públicos**: um inimigo oculto que abre uma porta, quebra um caixote ou acende óleo longe da visão revela que algo aconteceu ali (o MVP trata o mapa como conhecido; névoa de objetos fica para depois). Os ids dos personagens na ordem de iniciativa revelam a classe adversária (`mage-01`).
- Inimigo que entra na visão andando aparece na célula de onde deu o primeiro passo visível (uma célula ainda não visível); se aparece porque o *seu* personagem andou, surge no fim da animação.
- Estado inteiro a cada comando (~30 KB): suficiente para rede local, não para muitas salas.
- Lobby mínimo (sem convites, fila nem escolha de personagem; cenário fixo). Sem espectador pelo WebSocket (o Lab usa HTTP de debug).
- Segurança de desenvolvimento: tokens sem renovação, sem HTTPS, CORS por lista, rotas `/debug` ligadas fora de `NODE_ENV=production` (desligar com `GAME_DEV=0`).
- A sala abandonada (10 min sem ninguém) é só encerrada; não há derrota por abandono.
