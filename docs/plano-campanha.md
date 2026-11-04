# Plano — Modo Campanha PvE Cooperativo

**Data:** 04/11/2026
**Status:** decisões fechadas (sessão de *grill*); implementação ainda não iniciada.
**Piloto:** oneshot "O Mistério das Vacas Desaparecidas" (Fazenda Pedra Alta), adaptada ao sistema próprio.

Este documento registra **o que foi decidido**. Os números de balanceamento são pontos de partida, ajustados pelos testes (`npm run balance`, bots, playtest).

---

## 0. Contexto e premissas

| Tema | Decisão |
|---|---|
| Plataforma | **Navegador.** Continua Babylon.js + Colyseus + domínio TS determinístico, sem migrar para Unity ou Godot |
| Arquitetura | O servidor continua autoritativo e as regras continuam puras e determinísticas (comandos, eventos, hash, replay) |
| Escopo deste plano | Somente a campanha PvE. **Índice de poder no matchmaking e PvP 2×2/3×3 ficam num plano separado** |
| Ponto de partida no código | Hoje o `GameState` é **um mapa e sempre em turnos**, e a `Unit` **não tem atributos, perícias nem nível**. Já existem e serão reaproveitados: d20 contra CD, testes de resistência, dados com semente, visibilidade por equipe, objetos interativos ligados, status e superfícies, bots |

---

## 1. Exploração e combate

### 1.1. Modo fora de combate (decisão 1)
- **Livre na grade:** cada jogador envia comandos (mover, interagir, conversar, examinar) **a qualquer momento**, sem turno. O servidor processa **em ordem de chegada**.
- Continua discreto e determinístico, o que preserva replay, hash e testes.
- Em combate, entra o **modo de turnos atual** (iniciativa d20, PA, PM, Foco).

### 1.2. Transição para combate (decisão 2)
- **O grupo inteiro entra no combate, sempre**, inclusive quem está longe.
- Quem está **fora da área do combate** tem **movimento em dobro** nos próprios turnos, até chegar.
- **A câmera segue o personagem da vez** (aliado ou inimigo), e cada jogador pode movê-la manualmente.

### 1.3. Gatilhos de combate (decisão 3)
- **Roteirizados** pelo conteúdo (evento, área, interação, condição de pistas).
- **Percepção e patrulha** de inimigos: alcance de visão, detecção que inicia o combate e emboscadas (reaproveita o sistema de visibilidade).
- **Qualquer NPC pode ser atacado.** Cada NPC tem, em dados, as **escolhas e reações previstas** (quem foge, quem vira hostil, o que muda na história) e uma **reação default** para o que não foi previsto.

---

## 2. Diálogos (decisão 4)

- **Conversa privada:** só quem iniciou vê e escolhe as falas. Os outros continuam explorando.
- **NPC ocupado** enquanto conversa: ninguém abre uma conversa paralela com ele.
- O que for descoberto vai para o **diário compartilhado** do grupo.
- **Toda opção de fala tem limite de uso:**
  - `once`: uma vez para o grupo inteiro (ex.: o NPC entrega um item, que não pode ser obtido de novo por outro jogador);
  - `perCharacter`: uma vez por personagem (ex.: tentativas de Intuição);
  - `unlimited`: perguntas informativas, que podem ser repetidas.
- Opções podem ter **condições** (pistas, flags, itens, perícia) e **efeitos** (flags, itens, pistas, hostilidade), pelo mesmo sistema de gatilhos (§10).

---

## 3. Atributos, perícias e progressão

### 3.1. Atributos (decisões 5 e 7)
- **6 atributos:** FOR, DES, CON, INT, SAB, CAR.
- **Vêm da classe**, com uma pequena escolha na criação (+2 em um, +1 em outro).
- As aventuras de D&D são **adaptadas** a este sistema próprio.

### 3.2. Perícias (decisão 6)

| Perícia | Atributo | Absorve (5e) |
|---|---|---|
| Percepção | SAB | Percepção |
| Investigação | INT | Investigação |
| Intuição | SAB | Intuição |
| Conhecimento | INT | Arcana, Natureza, História, Religião |
| Sobrevivência | SAB | Sobrevivência, Lidar com Animais, Medicina |
| Persuasão | CAR | Persuasão, Enganação, Atuação |
| Intimidação | CAR | Intimidação |
| Atletismo | FOR/DES | Atletismo, Acrobacia |
| Furtividade | DES | Furtividade |
| Ladinagem | DES | Prestidigitação, Ferramentas de ladrão |

- Perícias podem ser modificadas por **itens, habilidades, magias e interações**, como mais um tipo de efeito com duração (reaproveita status e efeitos).

### 3.3. Progressão (decisão 7)
- **Nível por marcos:** sobe ao **concluir uma aventura**, sem XP. Cada aventura declara o nível recomendado.
- Um personagem único, usado na campanha e no PvP.

### 3.4. Itens persistentes (decisões 7, 8 e 10)
- Os itens conquistados ficam com o jogador **no mesmo estado** (cargas, durabilidade, encantamentos) e servem em outras campanhas e no PvP.
- **Cada item nasce com um UUID gerado e validado pelo servidor**, ligado ao **UUID da sessão de campanha** que o criou (rastreio de origem).
- Itens são **trocáveis entre jogadores**:
  - **Troca direta no lobby: entra na piloto.** Os dois confirmam, e o servidor transfere de forma atômica numa transação do Postgres, com **log de auditoria**;
  - **Marketplace: fase posterior.**
- **Itens de missão** ficam no **inventário do grupo** e são intransferíveis até o fim da aventura.
- **Banco no lobby:** o jogador guarda o que não quer arriscar e escolhe o que leva equipado para a campanha.
- No PvP, nível, atributos e itens entram no **índice de poder** do matchmaking (detalhado no plano de PvP).

---

## 4. Tempo e descanso

### 4.1. Relógio do mundo (decisões 11 e 12)
- **Explorar, conversar e investigar não gastam tempo.**
- O relógio avança **somente** com:
  - **descansos**, que exigem **voto unânime** do grupo;
  - **saltos roteirizados** pelo conteúdo (ex.: "anoitece" quando o grupo junta 3 pistas), com aviso na tela.
- **Não existe** a ação "Esperar até…".

### 4.2. Descansos (decisão 13)

| | Descanso curto | Descanso longo |
|---|---|---|
| Tempo | +1 h | +8 h |
| Limite | **1 por dia** de jogo | 1 por dia, **só em local seguro** (definido no mapa) |
| PV | +50% do **máximo**, limitado ao máximo | tudo |
| Foco | +50% do **máximo**, limitado ao máximo (Foco 10, atual 3 → 8; atual 8 → 10) | tudo |
| Habilidades "por descanso" | só as marcadas `short` | todas |
| Status negativos | removidos | removidos |
| Custo | 1 ração por personagem | 1 kit de acampamento por grupo + 1 ração por personagem |
| Consequências | eventos de relógio com gatilho por hora | eventos de relógio + **eventos noturnos** (sorteio numa tabela do conteúdo) |

- Sem suprimentos, não há descanso. Rações e kits vêm da loja ou do loot.
- **O descanso pode ser interrompido** por emboscada: o grupo entra em combate **sem recuperar nada**.
- Exemplos de consequência (piloto): cada noite sem resolver some uma vaca e a recompensa cai 10 PO; descansar na caverna tem chance de emboscada de filhote; depois de 3 noites, Davi foge com as pedras.

---

## 5. Mapas e portais

### 5.1. Mapas (decisão 14)
- **Feitos à mão** e **carregados sob demanda**: o servidor cria a instância e o cliente baixa o mapa quando o grupo atravessa.
- Mapas procedurais (salas pré-desenhadas encaixadas por semente) ficam como **evolução futura**.

### 5.2. Loot variável por sessão (decisão 14)
- Baús e recompensas apontam para **tabelas de loot predefinidas** (pesos e raridades).
- O sorteio usa a **semente da sessão** e acontece **ao abrir o baú**, ficando registrado no log. Duas sessões da mesma campanha podem ter itens diferentes, e um item raro pode aparecer numa sessão e não em outra.

### 5.3. Portais (decisões 15 e 16)
- Porta, poço, entrada de caverna etc.
- **Qualquer jogador propõe a travessia**, e todos votam **de onde estiverem**. Com voto unânime, o **grupo inteiro é transportado**.
- Só se pode propor a travessia por **portais já descobertos** (a descoberta pode exigir teste, como a Investigação CD 13 no poço).
- **Requisitos em dados:** itens (consumidos ou não), testes de perícia **por personagem** e flags da história (ex.: "Davi confessou").
- **A falha nunca bloqueia:** só define o custo (dano, perda de item, status). O grupo **sempre atravessa junto**.

### 5.4. Estado dos mapas (decisão 17)
- **Persistente por sessão:** inimigos mortos, baús abertos, objetos destruídos, portas e NPCs continuam como ficaram.
- **O tempo passa nos mapas inativos.** Implementação "preguiçosa": o mapa guarda a hora em que foi deixado e, ao ser reativado, o servidor aplica **em ordem** os eventos de relógio do intervalo (de forma determinística, pela semente).
- Só o mapa atual fica em memória. Os demais ficam no Postgres.

---

## 6. Sessão de campanha (decisões 18 a 20)

- **A campanha pertence a um líder** (quem criou), e **o save é dele**. O líder pausa, expulsa, convida e abre vagas.
- Cada comando é persistido (salvamento contínuo).
- **A sessão retoma com quem estiver presente.** Vagas podem ser ocupadas por **jogadores novos** no meio da campanha.
- **Quem cair, inclusive no meio do combate, sai da campanha e pode voltar.**
  - Ao sair, a unidade deixa o mapa e a iniciativa. O **inventário pessoal vai com o jogador**, e os **itens de missão ficam no grupo**.
  - Ao voltar, aparece junto ao grupo **no estado em que saiu**: na hora fora de combate, ou na rodada seguinte em combate.
- **Escala dos encontros:** as variantes são definidas no conteúdo por número de jogadores, e a escolhida é a do **número presente no início de cada combate**. Saídas e entradas no meio não mudam nada.
- Cada aventura declara `minPlayers` e `maxPlayers`. **Solo é permitido, mas não há variante de 1**: com menos gente que o mínimo, usa-se a variante do mínimo, com aviso antes de iniciar ou retomar.

---

## 7. Investigação e pistas (decisões 21 e 22)

- O teste é **automático na interação** (ex.: "Examinar a cama" rola Investigação CD 12).
- **Uma tentativa por ponto para o grupo inteiro:** quem tenta primeiro decide o resultado, e se falhar o ponto fica esgotado para todos.
- A falha pode ter **resultado próprio** (ex.: tirar 1 acorda o Davi).
- **Garantia de que a aventura não trava:**
  - **Validador estático** (`npm run validate-content`): monta o grafo de pistas e desbloqueios e **recusa** a aventura se algum objetivo obrigatório puder ficar inalcançável (redundância de fontes, como "2 de 4").
  - **Resgate em tempo de jogo:** se o servidor detecta que um objetivo virou impossível (NPC essencial morto, item perdido, jogador saiu), dispara o **evento de resgate** do conteúdo. Se não houver um, usa o **default genérico** (o diário entrega a pista).

---

## 8. Morte (decisões 23 e 24)

- A 0 PV, o personagem fica **caído** e faz **testes de morte** (d20 por turno: 3 sucessos estabiliza, 3 falhas morre). Aliados podem levantá-lo (ação ou poção).
- **Ao morrer:**
  - o **personagem sobrevive fora da campanha**: sai **daquela sessão** sem poder voltar a ela, e mantém nível e banco;
  - **perde o marco da aventura em curso** (não sobe de nível ao final);
  - **cada item carregado tem 50% de chance de ser destruído** (o UUID é marcado "destruído" e sai da economia). O restante **fica no corpo** para o grupo recolher, com a mudança de dono registrada no log;
  - o **ouro carregado** segue a mesma regra: metade destruída, metade no corpo.

---

## 9. Loot e recompensas (decisão 25)

- **Itens vão para quem abre** o baú. A divisão é combinada entre os jogadores (troca direta).
- **Moedas são divididas igualmente** entre os presentes, tanto as do loot quanto as recompensas de missão. A sobra de divisão não exata fica com quem abriu.
- **Itens de missão** vão para o inventário do grupo.

---

## 10. Inimigos, IA e sistema de gatilhos (decisão 26)

- **IA genérica com perfis em dados:** `agressivo`, `covarde` (foge com pouco PV), `protetor` (guarda uma área ou um ninho), `emboscador`.
- Habilidades especiais são habilidades do catálogo com **condições de uso**.
- **Gatilhos de encontro declarativos:** ex.: "a 50% de PV, surgem 2 filhotes"; "3 pedras devolvidas + Sobrevivência CD 13 → o chefe recua, e o combate termina com o desfecho *acalmado*".
- **Um único sistema de gatilhos (condição → efeito)** para todo o conteúdo: diálogos, pistas, relógio, descanso, portais, resgate, encontros e reações de NPC.
- Um script em TS por chefe fica só como último recurso.

---

## 11. Mecânicas novas de combate na piloto (decisão 27)

| Na oneshot | Implementação na piloto |
|---|---|
| Derrubado (cauda, FOR CD 13) | novo status |
| Amedrontado (rugido) | novo status |
| Arrastar para a água | deslocamento forçado que já existe (como o Empurrão) |
| Água até a cintura / natação | superfície com custo de movimento dobrado |
| Percepção às cegas | flag na unidade |
| Fuga do desabamento (final 3) | mecânica de portal: Atletismo CD 12 por personagem, falha = 1d6 de dano |
| **Escuridão e luz** | **2ª aventura.** Na piloto, a caverna usa penumbra só visual |
| **Desafio de perícia em grupo** (3 sucessos antes de 2 falhas) | **2ª aventura** |

---

## 12. Autoria de conteúdo (decisão 28)

- As aventuras são escritas em **TypeScript tipado** em `packages/content` (no mesmo padrão de classes e habilidades), **compiladas para JSON** e verificadas pelo validador.
- **Autores:** o dono do projeto e o Claude.
- **Editor visual** (junto com o editor de mapas): futuro.

---

## 13. Arte da piloto (decisão 29)

- **A fazenda é a cena da prova de gráficos** e vira o primeiro mapa da piloto: terreno com relevo, vegetação, kit modular, luz pré-calculada no Blender, pós-processamento.
- NPCs (Osvaldo, Marta, Davi, Tom, Geraldo), criaturas (vacas, filhotes, javalis, Devorador) e os outros mapas (casa do Geraldo, caverna) usam **arte provisória**, trocada depois pelo manifesto de assets.
- Orçamentos e pipeline de modelos: ver o Apêndice A.

---

## 14. Execução com orquestrador e workers (decisão 30)

### Etapa 0, sequencial (orquestrador)
1. **Contratos** em `packages/domain` e `packages/protocol`: `CampaignState` (sessão, mapas, relógio, flags, diário), atributos e perícias, linguagem de gatilhos, itens com UUID, mensagens de rede da campanha.
2. **Validar o PostgreSQL real** (`DATABASE_URL`). O driver `pg` nunca foi testado, e a campanha depende de persistência.

### Etapa 1, workers em paralelo (cada um na sua worktree)

| Worker | Escopo | Pastas principais |
|---|---|---|
| **W1 Regras** | exploração livre na grade, transição para combate (grupo todo, movimento em dobro), atributos e perícias, testes, descansos, testes de morte, status derrubado e amedrontado, superfície de água | `packages/domain` |
| **W2 Gatilhos e conteúdo em execução** | motor de gatilhos, diálogos (limites de uso, NPC ocupado), pistas e diário, eventos de relógio "preguiçosos", resgate, variantes de encontro | `packages/domain/campaign` (novo) |
| **W3 Servidor** | `CampaignRoom`, sessão multi-mapa no Postgres, líder e save, entrada e saída, votações (portal, descanso), UUID dos itens, banco, troca direta, log de auditoria, loot e moedas, perdas na morte | `apps/server` |
| **W4 Cliente** | interface de exploração, diálogo, diário, votações, carregamento de mapas sob demanda, câmera seguindo o turno, banco e troca | `apps/web` |
| **W5 Aventura** | oneshot das vacas em TS, validador do grafo de pistas | `packages/content`, `tools/validate-content` |
| **W6 Arte** | cena da fazenda (prova de gráficos), pipeline KTX2, atlas e LOD, modelos provisórios | `assets`, `tools/models`, `apps/web/src/rendering` |
| **W7 IA** | perfis de comportamento e IA para PvE | `packages/ai` |

### Etapa 2, integração (orquestrador)
- Ordem de merge: **W1 + W2 → W7 → W3 → W5 → W4 / W6**.
- Testes unitários, de integração e de invariantes, e **E2E de uma partida completa da oneshot com 2 a 4 clientes** (os três finais: matar, acalmar, destruir os ovos).

---

## 15. Fora deste plano

- **Plano separado de PvP:** índice de poder no matchmaking (nível, atributos e itens com pesos em dados; soma por equipe com limite individual; faixa que alarga com o tempo de fila; bot de poder equivalente; convites diretos ignoram o índice) e modos 2×2/3×3.
- **Fases posteriores:** marketplace, escuridão e luz, desafio de perícia em grupo, mapas procedurais, editor visual de aventuras e mapas, modo Hardcore.

---

## Apêndice A — Decisões técnicas de apoio (mesma conversa)

### Qualidade dos modelos 3D (alvo: tático estilizado PBR, câmera a 10–28 m)

| Tipo | Triângulos (LOD0 → LOD1 → LOD2) | Materiais | Texturas |
|---|---|---|---|
| Personagem jogável | 10–15 mil → 5 mil → 1,5 mil | 1–2 | 2048² (cor + normal + ORM) |
| Inimigo comum / NPC | 5–8 mil → 2,5 mil → 1 mil | 1 | 1024² |
| Chefe | 15–25 mil → 8 mil | 1–2 | 2048² |
| Prop pequeno | 300–1,5 mil | atlas compartilhado | 1024–2048 |
| Prop grande / construção | 2–10 mil por peça | trim sheet | tileável |
| Árvore | 3–8 mil → impostor | 2 | 1024² |
| Grama / folhagem | cards de 4–12 triângulos | 1 | 512–1024 |

- Cena: 300 mil – 1 milhão de triângulos visíveis, **< 300 draw calls**, **< 512 MB de textura na GPU**, download por mapa < 30–50 MB.
- Prioridades: atlas e junção de malhas por personagem; normal e ORM por bake; **KTX2/Basis no lugar de WebP**; LOD automático no `tools/models/optimize.ts`; **esqueleto humanoide único** compartilhado; definir o estilo antes de produzir em volume.

### Hospedagem (tudo numa VPS)
- Playtest: **2 vCPU / 4 GB / 80 GB SSD** (Droplet de ~US$ 24), Ubuntu 24.04, Caddy (TLS + WebSocket) → Node 22 (systemd) → PostgreSQL 16/17 em localhost, backup diário com `pg_dump`, Cloudflare na frente.
- Pendências: validar o PostgreSQL real; **retenção de snapshots** (~30 KB por comando, cerca de 2–3 MB por partida); IA dos bots em `worker_threads` e múltiplos processos com Redis quando um núcleo não bastar.
