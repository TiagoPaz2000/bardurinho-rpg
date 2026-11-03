# Plano Técnico e de Conteúdo — RPG Tático de Arena

**Versão de planejamento:** MVP 0.1  
**Data:** 03/11/2026

A proposta abaixo define um jogo pequeno, mas completo: criar personagem, escolher equipamento, entrar em uma partida, combater, receber recompensas e retornar ao lobby.

A arquitetura será dividida em três partes: regras do jogo, conteúdo configurável e apresentação visual. Essa separação permitirá alterar o dano de uma espada, acrescentar uma magia ou substituir um efeito visual sem modificar sistemas que não têm relação com aquela mudança.

Os valores de dano, vida, custos e duração são hipóteses iniciais de balanceamento. Esta é uma especificação para implementação, não um sistema já construído ou testado.

---

## 1. Escopo fechado do MVP

| Componente | Definição proposta |
|---|---|
| Plataforma | Navegador de computador |
| Cliente | Babylon.js + TypeScript |
| Servidor | Node.js + TypeScript + Colyseus |
| Banco de dados | PostgreSQL local |
| Multiplayer | Dois jogadores, cada um controlando um personagem |
| Modo contra computador | Mesmas regras do PvP, com três dificuldades |
| Mapa | Uma arena, com térreo e plataformas elevadas |
| Classes | Mago, ladino, guerreiro e druida |
| Habilidades especiais | Dez, distribuídas entre as classes |
| Itens de combate | Quatorze definições, sem atributos aleatórios |
| Criação de personagem | Nome, classe, aparência predefinida e cores |
| Progressão | Moedas e recompensas cosméticas |
| Loja | Apenas itens cosméticos no MVP |
| Fora do escopo | Campanha, grupos de quatro personagens, invocações, transformação do druida, comércio entre jogadores e destruição estrutural livre |

O Colyseus será utilizado para salas e sincronização, mantendo o servidor como responsável pelas alterações de estado. As regras de combate continuarão sendo código próprio do projeto.

---

## 2. Regras básicas do combate

### 2.1. Recursos do personagem

| Recurso | Funcionamento |
|---|---|
| Pontos de vida — PV | Ao chegar a zero, o personagem é derrotado |
| Pontos de ação — PA | Dois por turno; utilizados para atacar, usar habilidades, consumir itens e interagir |
| Pontos de movimento — PM | Definidos pela classe; recuperados no início do próprio turno |
| Foco | Recurso utilizado pelas habilidades; começa cheio e recupera dois pontos por turno, até o máximo |
| Armadura | Reduz dano físico |
| Resistência elemental | Reduz dano do elemento correspondente |
| Barreira | Absorve dano depois da aplicação de armadura ou resistência |

Foco representará energia mágica para mago e druida, e esforço para guerreiro e ladino. Isso evita implementar quatro sistemas de recursos diferentes logo no início.

| Classe | PV | PA | PM | Foco máximo | Armadura do equipamento inicial |
|---|---:|---:|---:|---:|---:|
| Mago | 80 | 2 | 5 | 10 | 0 |
| Ladino | 90 | 2 | 6 | 8 | 2 |
| Guerreiro | 110 | 2 | 5 | 8 | 4 |
| Druida | 95 | 2 | 5 | 10 | 2 |

A armadura indicada já considera a roupa equipada. Ela não será somada novamente como atributo da classe. O acessório escolhido poderá modificar esses valores.

### 2.2. Turnos e ações

Um turno é a oportunidade de um jogador agir. Uma rodada termina depois que ambos tiveram seu turno.

Cada turno terá limite inicial de 45 segundos. Ao terminar o tempo, o servidor encerrará o turno automaticamente. PA e PM não utilizados não serão acumulados.

O jogador poderá intercalar deslocamento e ações: andar, atacar e continuar andando, desde que possua recursos.

| Ação | Custo | Regra |
|---|---:|---|
| Ataque básico | 1 PA | Utiliza uma arma disponível no equipamento |
| Mover | PM do percurso | Não consome PA |
| Defender | 1 PA | Concede barreira de seis pontos até o início do próximo turno próprio; uma utilização por turno |
| Interagir | 1 PA | Abrir porta, acionar alavanca, abrir baú ou utilizar recurso do mapa |
| Usar consumível | 1 PA | Consome uma unidade |
| Encerrar turno | Sem custo | Entrega a vez ao adversário |

No MVP, ataques válidos não terão rolagem de acerto, crítico ou variação aleatória de dano. Isso facilitará a leitura das decisões e os testes.

Vitória ocorrerá por eliminação, desistência ou abandono confirmado. Morte simultânea após a resolução completa de uma explosão resultará em empate. Após vinte rodadas completas sem vencedor, a partida também terminará empatada.

### 2.3. Dano e distância

Para dano físico:

```text
Dano após mitigação = máximo entre zero e dano bruto − armadura
```

Para dano elemental:

```text
Dano após mitigação = máximo entre zero e dano bruto − resistência ao elemento
```

A barreira absorve o resultado; apenas o restante reduz os PV.

Exemplo: uma espada causa 18 de dano físico contra armadura 4 e barreira 6. O dano após armadura é 14; a barreira absorve seis; o personagem perde oito PV.

O mapa utilizará uma grade lógica, mesmo que ela fique escondida durante a apresentação. O deslocamento ocorrerá em quatro direções, sem diagonais no MVP.

Ataques entre andares exigirão linha de visão e considerarão a diferença de altura.

```text
Distância = |diferença em X| + |diferença em Y| + 2 × |diferença de andar|
```

Ataques corpo a corpo exigirão o mesmo andar. Efeitos de área não atravessarão automaticamente pisos e tetos.

---

## 3. Catálogo de itens

Serão quatorze definições: cinco armas, três armaduras, três acessórios e três consumíveis.

### 3.1. Armas

Todos os ataques básicos custarão um PA e nenhum Foco.

| Item | Classe | Dano | Alcance | Limitações |
|---|---|---:|---|---|
| Espada de ferro | Guerreiro | 18 físico | Uma célula | Mesmo andar |
| Adaga | Ladino | 16 físico | Uma célula | Mesmo andar |
| Arco curto | Ladino | 14 físico | Duas a seis células | Exige linha de visão; não dispara contra alvo adjacente |
| Varinha arcana | Mago | 14 arcano | Até cinco células | Exige linha de visão |
| Cajado natural | Druida | 12 natureza | Até quatro células | Exige linha de visão |

O ladino terá arco e adaga no mesmo equipamento. O jogador escolherá o ataque apropriado, sem um sistema separado de troca de arma.

Não haverá munição limitada para o arco no MVP.

### 3.2. Armaduras e acessórios

| Item | Efeito | Restrição |
|---|---|---|
| Túnica | Armadura 0 | Mago |
| Armadura de couro | Armadura 2 | Ladino e druida |
| Cota reforçada | Armadura 4 | Guerreiro |
| Amuleto da vitalidade | +8 PV máximos | Um acessório equipado |
| Medalhão das cinzas | Resistência a fogo 2 | Um acessório equipado |
| Medalhão da geada | Resistência a frio 2 | Um acessório equipado |

As armaduras serão fixas por classe. O acessório será escolhido antes da partida.

Todos os acessórios de combate estarão disponíveis desde o início. A progressão não dará vantagem permanente de atributos no PvP.

### 3.3. Consumíveis

| Item | Efeito | Uso e limitações |
|---|---|---|
| Poção de vida | Recupera 24 PV | Apenas no próprio personagem; não ultrapassa o máximo |
| Poção de Foco | Recupera quatro pontos | Apenas no próprio personagem; não ultrapassa o máximo |
| Frasco de óleo | Cria óleo em uma área de até cinco células | Alcance quatro; exige linha de visão; não causa dano imediato |

Cada personagem entrará com dois consumíveis de tipos diferentes. Haverá dois espaços de consumíveis e, no máximo, uma unidade de cada tipo carregada simultaneamente.

Esses itens serão recursos temporários da partida. Não será necessário comprar poções antes de cada confronto, e sobras não serão transferidas para o inventário permanente.

---

## 4. Catálogo das dez habilidades

Para evitar ambiguidade, a recarga será definida como quantidade de turnos próprios seguintes em que a habilidade permanece bloqueada.

Recarga 1 significa: usar agora, não poder usar no próximo turno próprio e voltar a usar no seguinte.

Cada habilidade especial poderá ser usada, no máximo, uma vez por turno, mesmo quando sua recarga for zero.

| Classe e habilidade | Custo | Alcance | Efeito | Recarga |
|---|---|---|---|---:|
| Mago — Chama concentrada | 1 PA + 2 Foco | Seis células | 18 de fogo no alvo da célula; aplica Queimando; produz calor capaz de incendiar óleo e materiais inflamáveis | 0 |
| Mago — Raio de geada | 1 PA + 2 Foco | Seis células | 14 de frio; aplica Lentidão; apaga fogo na célula atingida e remove Queimando do alvo | 1 |
| Mago — Barreira arcana | 1 PA + 3 Foco | Próprio personagem | Concede barreira de 18 pontos até o início do segundo turno próprio seguinte | 2 |
| Ladino — Tiro preciso | 1 PA + 3 Foco | Duas a sete células | 22 de dano físico; exige arco e linha de visão | 1 |
| Ladino — Ocultação | 1 PA + 2 Foco | Próprio personagem | Permite ficar Oculto em condições válidas; primeiro ataque realizado enquanto Oculto recebe +4 de dano bruto e encerra o efeito | 2 |
| Guerreiro — Investida | 1 PA + 2 Foco | Percurso de até quatro PM | Desloca até uma posição adjacente ao alvo e causa 16 de dano físico, sem descontar os PM normais | 1 |
| Guerreiro — Empurrão | 1 PA + 2 Foco | Uma célula | Causa seis de dano físico e desloca o alvo até duas células em linha reta | 1 |
| Druida — Espinheiro | 1 PA + 3 Foco | Cinco células | Cria área de espinhos de até cinco células, com dano e movimento dificultado | 1 |
| Druida — Cura natural | 1 PA + 4 Foco | Próprio personagem | Recupera 24 PV | 2 |
| Druida — Enraizar | 1 PA + 3 Foco | Cinco células | Causa oito de natureza e impede movimento voluntário no próximo turno do alvo | 2 |

### Limitações complementares

- Investida não atravessa portas fechadas, personagens ou escadas.
- O percurso passa pelas mesmas verificações de terreno e perigo de um deslocamento comum.
- Um guerreiro pode morrer ao investir através do fogo antes de concluir o ataque.
- Empurrão não atravessa paredes nem derruba personagens de plataformas no MVP.
- Enraizamento impede movimento voluntário, mas não impede deslocamentos forçados.
- Ocultação somente poderá ser ativada fora da visão inimiga ou dentro de uma área escura.
- O efeito de ocultação termina ao final do próximo turno próprio, ao atacar, receber dano ou ser revelado.
- Espinheiro terá formato de cruz: célula central e quatro vizinhas.
- Células incompatíveis não serão substituídas.

---

## 5. Estados, durações e interações

### 5.1. Estados aplicados aos personagens

| Estado | Efeito | Duração e acúmulo |
|---|---|---|
| Queimando | Quatro de fogo no início do turno | Dois próximos inícios de turno do alvo; reaplicar renova a duração, sem somar instâncias |
| Lentidão | −2 PM | Durante o próximo turno do alvo; não acumula |
| Enraizado | Impede movimento voluntário | Durante o próximo turno do alvo; permite atacar e usar outras ações |
| Barreira | Absorve dano depois da mitigação | Não soma barreiras; um efeito mais fraco não prolonga nem aumenta uma barreira mais forte |
| Oculto | Restringe a detecção conforme as condições do mapa | Duração e revelação conforme a habilidade |

O sistema armazenará explicitamente o evento de expiração.

### 5.2. Superfícies

Cada célula terá, inicialmente, uma única superfície de gameplay.

| Superfície | Efeito |
|---|---|
| Normal | Movimento padrão |
| Óleo | Entrar custa dois PM; pode incendiar |
| Fogo | Causa seis de fogo ao entrar ou iniciar o turno |
| Espinhos | Entrar custa dois PM; causa cinco de dano físico ao entrar ou iniciar o turno |

O dano de uma mesma categoria de superfície ocorrerá, no máximo, uma vez por personagem por turno global.

Criar uma superfície diretamente sob um personagem também contará como exposição inicial.

Fogo no chão e Queimando serão efeitos diferentes.

### 5.3. Matriz inicial de reações

| Combinação | Resultado |
|---|---|
| Calor + óleo | Consome o óleo e cria fogo por três rodadas |
| Calor + espinhos | Destrói os espinhos e cria fogo por duas rodadas |
| Calor + madeira inflamável | Aplica combustão ao objeto |
| Fogo + barril explosivo | Detona o barril |
| Frio + fogo | Remove o fogo da célula atingida |
| Frio + Queimando | Remove a queimadura |
| Água da cisterna + fogo | Apaga o fogo na área |
| Água + personagem ou madeira queimando | Remove a combustão |
| Óleo lançado sobre fogo | Incendeia imediatamente |
| Espinhos sobre óleo ou fogo | Não substituem a superfície existente |

Uma superfície criada na rodada R com duração de três rodadas expirará no início de R + 3.

O incêndio poderá percorrer uma mancha conectada de óleo no mesmo andar. Não haverá propagação física contínua para todo o cenário.

---

## 6. Mapa do MVP — Pátio das Ruínas

A arena proposta terá térreo de 16 × 16 células, duas plataformas elevadas e distribuição aproximadamente simétrica dos recursos.

Cada célula representará dois metros. As plataformas estarão quatro metros acima do térreo.

### 6.1. Elementos e recursos

| Elemento | Quantidade | Regra |
|---|---:|---|
| Pontos de início | 2 | Em lados opostos, sem ataque direto imediato entre eles |
| Plataformas elevadas | 2 | Áreas de aproximadamente 6 × 2 células |
| Escadas | 2 | Conexões explícitas entre andares; atravessar a conexão custa dois PM |
| Portas de madeira | 2 | 30 PV; abrir ou fechar custa um PA; podem queimar e ser destruídas |
| Portão central | 1 | Indestrutível no MVP; controla uma passagem |
| Alavanca do portão | 1 | Acionamento adjacente por um PA |
| Barris explosivos | 4 | Oito PV; explodem ao chegar a zero ou receber estímulo de fogo |
| Caixas ou barricadas | 4 | 20 PV; bloqueiam passagem; podem queimar |
| Manchas iniciais de óleo | 2 | Três células cada |
| Cisternas | 2 | Um uso por partida; apagam fogo em uma área de cinco células |
| Baús de suprimentos | 2 | Uma poção de vida cada; exigem espaço no inventário temporário |
| Altares de Foco | 2 | Recuperam quatro Foco; um uso por altar em cada partida |
| Áreas escuras | 2 | Alcovas com regra de detecção reduzida |

Barris causarão 20 de fogo em uma área de raio lógico 1, limitada pelo andar e por paredes. Poderão provocar reação em cadeia.

### 6.2. Visibilidade

A regra inicial será visão de até oito células, limitada por obstáculos.

Em áreas escuras, personagens serão detectados apenas a até duas células, com linha de visão, ou quando iluminados.

Fogo produzirá iluminação lógica em até duas células.

---

## 7. Lista de modelos, ícones, animações e efeitos

### 7.1. Modelos 3D

| Grupo | Recursos a produzir ou fornecer |
|---|---|
| Personagens | Um corpo humanoide base, um esqueleto compartilhado e quatro conjuntos visuais de classe |
| Armas | Espada, adaga, arco, varinha e cajado |
| Consumíveis | Um frasco base com três variações de material |
| Construção | Piso, parede reta, canto, pilar, escada, plataforma e guarda-corpo |
| Interativos | Porta, portão, alavanca, barril, caixa, baú, cisterna, altar e tocha |
| Estados destruídos | Porta quebrada, caixa quebrada e restos de barril |

### 7.2. Animações

Conjunto compartilhado:

```text
idle
walk
run
melee
shoot
cast_forward
cast_self
hit
death
interact
```

Portas, portão, alavanca e baú terão animações simples próprias.

### 7.3. Ícones

| Categoria | Quantidade inicial |
|---|---:|
| Habilidades | 10 |
| Itens | 14 |
| Estados do personagem | 5 |
| Classes | 4 |
| Recursos | 8 |
| Ações | 8 |
| Total | 49 |

Proposta de entrega: imagens-mestre de 256 × 256 pixels.

### 7.4. Famílias de efeitos visuais

| Família | Utilização |
|---|---|
| Projétil elemental | Fogo, gelo, arcano e natureza |
| Impacto | Acerto físico ou mágico |
| Barreira | Proteção arcana e Defender |
| Ocultação | Transição visual do ladino |
| Rastro de flecha | Ataque básico e Tiro preciso |
| Investida | Poeira e rastro curto |
| Empurrão | Onda de impacto |
| Espinheiro | Superfície persistente |
| Cura | Partículas e brilho |
| Raízes | Estado Enraizado |
| Explosão | Barris |
| Fogo contínuo | Chão, madeira e personagem queimando |
| Óleo | Material ou decalque |
| Água | Ativação da cisterna |
| Madeira quebrando | Destruição de porta ou caixa |

---

## 8. Como controlar os efeitos e chegar a cem magias

### 8.1. Separar definição, instância e apresentação

| Camada | Exemplo |
|---|---|
| Definição | “Queimando causa quatro de fogo em dois inícios de turno” |
| Instância ativa | “O personagem B está Queimando, aplicado pelo personagem A, com uma aplicação restante” |
| Apresentação | “Mostrar partículas de fogo, ícone e número de dano” |

### 8.2. Operações reutilizáveis

| Operação | Responsabilidade |
|---|---|
| `damage` | Aplicar dano tipado |
| `heal` | Recuperar PV |
| `applyStatus` | Aplicar estado |
| `removeStatus` | Remover estado |
| `grantShield` | Conceder barreira |
| `restoreResource` | Recuperar Foco ou outro recurso |
| `move` | Deslocamento voluntário |
| `forceMove` | Empurrão ou outro deslocamento forçado |
| `createSurface` | Criar superfície |
| `removeSurface` | Remover superfície |
| `changeObjectState` | Abrir, fechar, consumir ou destruir |
| `emitStimulus` | Produzir calor, frio ou água |

Exemplo de definição:

```json
{
  "id": "mage.flame",
  "version": 1,
  "classId": "mage",
  "cost": {
    "ap": 1,
    "focus": 2
  },
  "maxUsesPerTurn": 1,
  "blockedOwnTurnsAfterUse": 0,
  "target": {
    "kind": "cell",
    "range": 6,
    "requiresLineOfSight": true
  },
  "effects": [
    {
      "op": "damage",
      "selector": "targetCellOccupants",
      "amount": 18,
      "damageType": "fire"
    },
    {
      "op": "applyStatus",
      "selector": "survivingUnitsHit",
      "statusId": "burning"
    },
    {
      "op": "emitStimulus",
      "selector": "targetCell",
      "stimulus": "heat"
    }
  ],
  "presentation": {
    "iconId": "icon.flame",
    "animationId": "cast_forward",
    "vfxId": "projectile.fire"
  }
}
```

### 8.3. Reações ambientais em módulo próprio

A magia não deverá conhecer todos os objetos do cenário.

Exemplo:

```text
Chama -> produz calor
Calor + óleo -> cria fogo
Calor + barril explosivo -> detona barril
Calor + madeira -> aplica combustão
```

Essa divisão evita implementar a mesma lógica de incêndio em cada magia futura.

### 8.4. Caminho de expansão

| Crescimento | Trabalho necessário |
|---|---|
| Nova magia com dano e queimadura | Nova definição, ícone, parâmetros visuais e testes |
| Nova magia com dano em linha | Novo formato de seleção, se ainda não existir |
| Nova magia que empurra e cria gelo | Composição de operações existentes |
| Invocação de criatura | Nova mecânica |
| Transformação do druida | Nova mecânica |
| Reação fora do turno | Alteração do fluxo de combate |

Cem magias não significarão cem sistemas independentes.

---

## 9. Arquitetura de módulos

A recomendação é um **monólito modular**: um único servidor, com responsabilidades separadas internamente.

| Módulo | Responsabilidade | Limite importante |
|---|---|---|
| Identidade | Contas, sessões e autenticação | Não calcula atributos |
| Personagens | Nome, classe, aparência e equipamento | Não altera partida iniciada |
| Catálogo | Classes, habilidades, itens, estados e versões | Não armazena PV atuais |
| Inventário | Cosméticos e configurações salvas | Não controla consumíveis temporários |
| Loja e economia | Preços, moedas e compras | Não modifica combate |
| Lobby | Convites, presença e escolha de modo | Não resolve ataques |
| Matchmaking | Fila e reserva de vagas | Não implementa combate |
| Partida | Participantes, turnos, encerramento e reconexão | Não contém detalhes de cada magia |
| Combate | Custos, ataques, dano e resultado das ações | Não conhece partículas |
| Efeitos | Estados, superfícies e reações | Não acessa a loja |
| Mapa | Caminhos, ocupação, andares e linha de visão | Não depende da malha visual detalhada |
| IA | Escolher comandos usando informações permitidas | Não altera o estado diretamente |
| Missões e recompensas | Progresso e concessões | Não aceita vitória declarada pelo cliente |
| Persistência | Salvar e recuperar dados | Não decide balanceamento |
| Apresentação | UI, câmera, modelos e VFX | Não decide resultados oficiais |

### Estrutura sugerida do repositório

```text
apps/
  web/
    screens/
    rendering/
    animation/
    vfx/
    network/

  server/
    modules/
      identity/
      characters/
      inventory/
      shop/
      lobby/
      matchmaking/
      matches/
      rewards/
      ai/
    adapters/
      colyseus/
      postgres/

packages/
  domain/
    combat/
    effects/
    movement/
    visibility/
    rules/

  protocol/
    commands/
    responses/
    schemas/

  content/
    classes/
    abilities/
    items/
    statuses/
    reactions/
    maps/

  assets-manifest/

tools/
  validate-content/
  simulate-battles/
  export-map/

tests/
  unit/
  integration/
  scenarios/
```

O núcleo de regras não importará Babylon.js, Colyseus ou PostgreSQL.

---

## 10. Ambiente local e banco de dados

### 10.1. Processos locais

| Processo | Endereço proposto | Função |
|---|---|---|
| Cliente de desenvolvimento | `127.0.0.1:5173` | Interface e arquivos visuais |
| Servidor de jogo | `127.0.0.1:2567` | API HTTP, WebSocket, salas e regras |
| PostgreSQL | `127.0.0.1:5432` | Persistência |

### 10.2. Organização dos dados

| Grupo | Dados persistidos |
|---|---|
| Contas e sessões | Identidade, credenciais protegidas e sessões |
| Personagens | Classe, nome, aparência e equipamento |
| Inventário | Cosméticos desbloqueados |
| Economia | Saldo e histórico de movimentações |
| Compras | Solicitação, produto, preço e resultado |
| Partidas | Participantes, modo, versão e resultado |
| Estado da partida | Último estado confirmado |
| Comandos | Identificador, autor, conteúdo e resultado |
| Eventos | Histórico das mudanças de gameplay |
| Missões | Progresso e recompensas |

No MVP local, cada comando aceito salvará o novo estado da partida.

---

## 11. Fluxo servidor → validação → processamento → resposta

### 11.1. O navegador envia intenção

```json
{
  "type": "USE_ABILITY",
  "protocolVersion": 1,
  "commandId": "7cb2b730-99ab-4c2a-9af6-f60cd1842c81",
  "expectedTurnId": 17,
  "actorId": "hero-A",
  "abilityId": "mage.flame",
  "target": {
    "kind": "cell",
    "x": 8,
    "y": 7,
    "floor": 0
  }
}
```

O cliente não envia dano calculado.

### 11.2. Sequência de processamento

| Etapa | Trabalho do servidor |
|---|---|
| 1. Identificar | Recuperar sessão autenticada e partida |
| 2. Validar formato | Conferir tipo, campos e limites |
| 3. Verificar repetição | Conferir `commandId` |
| 4. Autorizar | Confirmar controle do personagem |
| 5. Validar contexto | Partida ativa, turno correto e personagem vivo |
| 6. Validar habilidade | Classe, recarga, uso e recursos |
| 7. Validar alvo | Alcance, andar, linha de visão e regras |
| 8. Simular | Criar estado candidato |
| 9. Resolver consequências | Dano, estados, fogo, explosões e mortes |
| 10. Persistir | Salvar comando, eventos e estado |
| 11. Confirmar | Tornar o estado candidato oficial |
| 12. Projetar e enviar | Criar a visão permitida para cada jogador |

Cada partida terá sua própria fila de processamento.

### 11.3. Exemplo de sequência de eventos

```text
Foco gasto
-> dano aplicado
-> óleo incendiado
-> barril detonado
-> barricada destruída
-> passagem liberada
```

O navegador apenas representa esses eventos.

### 11.4. Informações ocultas

O servidor não enviará ao adversário posições ou eventos que ele não poderia conhecer.

A visão individual será montada no servidor.

### 11.5. Reconexão

- Reserva de vaga: 90 segundos.
- Cronômetro continua normalmente.
- Turnos perdidos são encerrados automaticamente.
- O jogador recebe um snapshot atualizado ao reconectar.

---

## 12. Personagem, lobby, matchmaking, loja e recompensas

### 12.1. Criação de personagem

O jogador escolherá:

- Nome.
- Classe.
- Conjunto visual.
- Cores.
- Acessório.
- Dois consumíveis iniciais.

O servidor calculará os atributos.

### 12.2. Fluxo do lobby

```text
Login
-> Personagem
-> Lobby
-> Convite / Fila / Bot
-> Carregamento
-> Partida
-> Resultado
-> Recompensas
-> Lobby
```

### 12.3. Loja e recompensas

| Recompensa ou compra | Proposta inicial |
|---|---|
| Vitória PvP | 30 moedas |
| Derrota PvP concluída | 10 moedas |
| Empate | 15 moedas |
| Vitória contra bot | 10 moedas |
| Cor alternativa | 50 moedas |
| Retrato | 80 moedas |
| Aparência de classe | 200 moedas |

### Missões iniciais

| Missão | Recompensa |
|---|---|
| Concluir três partidas | Cor alternativa |
| Obter a primeira vitória | Moldura de retrato |
| Incendiar dois barris em partidas concluídas | Variação visual de equipamento |

---

## 13. Bot e níveis de dificuldade

| Nível | Estratégia proposta |
|---|---|
| Fácil | Avalia ações imediatas e pode escolher opções inferiores |
| Normal | Compara dano, cura, defesa, posição e ambiente |
| Difícil | Examina algumas sequências e possíveis respostas |

O bot usará o mesmo formato de comando dos jogadores.

Ele não poderá:

- Alterar PV diretamente.
- Ignorar custo.
- Conhecer posições ocultas.
- Executar ações inválidas.

---


## 14. Sistema de câmera da partida

A câmera será tratada como um sistema exclusivamente do cliente. Ela não participa das regras oficiais do combate e não altera posição, linha de visão, alcance, colisão ou qualquer outro resultado processado pelo servidor.

A proposta para o MVP é uma câmera 3D elevada com aparência isométrica/tática, mantendo liberdade controlada de movimentação para não aumentar excessivamente a complexidade do projeto.

### 14.1. Comportamento geral

A câmera utilizará:

- Visão elevada em aproximadamente 45°.
- Inclinação fixa.
- Rotação horizontal em passos de 90°.
- Quatro orientações: 0°, 90°, 180° e 270°.
- Zoom limitado.
- Pan pelo mapa.
- Recentragem no personagem ativo.
- Foco automático opcional em ações importantes.
- Transparência de obstáculos entre câmera e personagem.
- Tratamento visual específico para múltiplos andares.

A câmera totalmente livre em 360°, com inclinação vertical ajustável pelo jogador, ficará fora do MVP.

### 14.2. Controles propostos

| Controle | Função |
|---|---|
| WASD | Mover a câmera pelo mapa |
| Q / E | Girar a câmera em passos de 90° |
| Scroll do mouse | Aproximar ou afastar |
| F | Recentrar no personagem ativo |
| Clique esquerdo | Selecionar célula, personagem ou objeto |
| Clique e arraste / botão do meio | Pan alternativo da câmera |
| Esc | Cancelar seleção ou habilidade atual |

Os atalhos poderão ser alterados posteriormente em um sistema de configuração.

### 14.3. Arquitetura do módulo de câmera

Estrutura sugerida:

```text
camera/
  CameraController
  CameraInput
  CameraFocus
  CameraOcclusion
  CameraTransitions
  CameraBounds
  CameraEventQueue
```

Responsabilidades:

| Componente | Responsabilidade |
|---|---|
| `CameraController` | Posição, rotação, zoom e estado atual da câmera |
| `CameraInput` | Teclado, mouse e futuramente controle |
| `CameraFocus` | Focar personagem, célula, alvo ou evento |
| `CameraOcclusion` | Transparência de paredes, pilares e elementos que bloqueiam a visão da câmera |
| `CameraTransitions` | Movimentos suaves entre enquadramentos |
| `CameraBounds` | Impedir que a câmera saia excessivamente da arena |
| `CameraEventQueue` | Organizar focos automáticos durante habilidades, impactos e explosões |

### 14.4. Separação entre câmera e regras do jogo

A posição da câmera não será enviada ao servidor como parte das ações de combate.

O servidor continuará trabalhando apenas com informações como:

```text
x
y
floor
actorId
targetId
abilityId
```

Exemplo:

```text
SERVIDOR
posição real
linha de visão
regras de andar
bloqueios
alcance
estado da partida

        ↓

CLIENTE
câmera
zoom
rotação
transparência
animações
efeitos visuais
```

Girar a câmera 180° não altera absolutamente nada nas regras da partida.

### 14.5. Seleção de células e objetos

O clique do jogador será convertido pelo cliente em uma posição lógica do mundo.

Fluxo:

```text
Mouse
↓
Raycast da câmera
↓
Malha ou célula atingida
↓
Conversão para posição lógica
↓
x, y, floor
↓
Envio da intenção ao servidor
```

Exemplo de comando:

```json
{
  "type": "MOVE",
  "target": {
    "x": 7,
    "y": 10,
    "floor": 1
  }
}
```

A câmera não fará parte desse comando.

### 14.6. Câmera e múltiplos andares

O mapa possui térreo e plataformas elevadas.

Cada entidade continuará utilizando:

```text
x
y
floor
```

Quando um personagem ou alvo de interesse estiver em outro nível, o cliente poderá:

- Ajustar a altura da câmera.
- Alterar o ponto de foco.
- Tornar partes do piso ou teto temporariamente transparentes.
- Reduzir a opacidade de estruturas que estejam bloqueando o enquadramento.
- Destacar o andar atualmente relevante.

Essas alterações são apenas visuais.

Um piso transparente para a câmera continua bloqueando visão, movimento ou projéteis caso as regras do mapa indiquem isso.

### 14.7. Sistema de oclusão

Paredes, pilares ou estruturas entre câmera e personagem poderão se tornar temporariamente semitransparentes.

Exemplo:

```text
Camera
   ↓
████ parede ████
       ↓
    personagem
```

O sistema identifica que o obstáculo está entre a câmera e o alvo de foco e reduz sua opacidade apenas no cliente.

Essa transparência:

- Não altera a colisão.
- Não altera linha de visão.
- Não altera cobertura.
- Não altera alcance.
- Não revela personagens que o jogador não deveria enxergar.

O `CameraOcclusion` trabalhará apenas sobre objetos que o cliente já possui autorização para renderizar.

### 14.8. Mira de habilidades

Ao selecionar uma habilidade, o cliente exibirá informações visuais antes da confirmação.

Cores propostas:

| Cor | Significado |
|---|---|
| Verde | Célula válida |
| Vermelho | Célula inválida |
| Amarelo | Área que será afetada |
| Azul | Caminho ou deslocamento |
| Cinza | Área indisponível |

Fluxo:

```text
Selecionar habilidade
↓
Cliente calcula prévia visual
↓
Jogador movimenta o cursor
↓
Células válidas e área aparecem
↓
Jogador confirma
↓
Servidor recalcula e valida
↓
Ação é aceita ou rejeitada
```

A prévia do cliente serve apenas para resposta imediata da interface.

O servidor continuará recalculando:

- Alcance.
- Linha de visão.
- Recursos.
- Andar.
- Área de efeito.
- Obstáculos.
- Alvos permitidos.

### 14.9. Modo normal e modo de habilidade

A câmera terá dois estados principais.

#### Modo tático

Utilizado para exploração da arena durante o turno.

Permite:

- Pan.
- Rotação.
- Zoom.
- Seleção de personagem.
- Seleção de objetos.
- Recentragem.

#### Modo de habilidade

Ativado depois que o jogador seleciona uma habilidade.

Permite:

- Continuar movendo a câmera.
- Visualizar alcance.
- Ver área de efeito.
- Inspecionar alvos.
- Cancelar a habilidade.
- Confirmar o alvo.

A câmera não ficará totalmente bloqueada durante a seleção de uma habilidade.

### 14.10. Eventos automáticos de câmera

O servidor poderá devolver uma sequência de eventos de gameplay como:

```text
CAST_STARTED
PROJECTILE_CREATED
DAMAGE_APPLIED
BARREL_EXPLODED
OBJECT_DESTROYED
```

O cliente poderá transformar essa sequência em comportamento visual:

```text
focar personagem
↓
acompanhar início da habilidade
↓
focar impacto
↓
abrir enquadramento para explosão
↓
retornar ao personagem ativo
```

O servidor não enviará comandos como "mova a câmera para X".

Ele enviará eventos de gameplay, e o cliente decidirá como apresentá-los.

### 14.11. CameraEventQueue

O `CameraEventQueue` evitará conflitos entre vários eventos.

Exemplo:

```text
1. mage.cast
2. projectile.travel
3. barrel.explosion
4. door.destroyed
5. return.control
```

Cada evento poderá conter:

```text
eventType
priority
targetEntity
targetCell
durationHint
interruptible
```

Esse sistema será visual e não afetará a resolução da partida.

### 14.12. Interrupção da câmera automática

O jogador poderá interromper uma transição automática ao:

- Mover a câmera.
- Girar a câmera.
- Alterar o zoom.
- Pressionar uma tecla de cancelamento.

Depois disso, a câmera volta imediatamente ao controle manual.

Isso evita que sequências cinematográficas atrapalhem jogadores que preferem partidas rápidas.

### 14.13. Preferência de câmera automática

A interface poderá disponibilizar:

```text
Câmera automática de combate

[ Alta ]
[ Reduzida ]
[ Desativada ]
```

#### Alta

A câmera acompanha conjuração, projétil, impacto, explosões e destruições relevantes.

#### Reduzida

A câmera foca apenas grandes eventos e não acompanha projéteis simples.

#### Desativada

Nenhum movimento automático, exceto situações indispensáveis, como início da partida ou retorno após reconexão.

### 14.14. Reconexão e câmera

Quando um jogador reconectar:

1. O servidor envia o snapshot autorizado da partida.
2. O cliente reconstrói a cena.
3. A câmera é posicionada no personagem ativo ou no último foco local salvo.
4. Eventos antigos não precisam ser reproduzidos cinematicamente.
5. O jogador recebe imediatamente o controle da câmera.

A câmera não dependerá do histórico completo da partida para funcionar.

### 14.15. Limites do MVP

| Recurso | MVP |
|---|---|
| Visão elevada | Sim |
| Pan | Sim |
| Zoom | Sim |
| Rotação | 0°, 90°, 180° e 270° |
| Inclinação livre | Não |
| Rotação 360° contínua | Não |
| Foco no personagem | Sim |
| Foco em habilidades | Sim |
| Transparência de obstáculos | Sim |
| Tratamento de múltiplos andares | Sim |
| Câmera cinematográfica | Limitada |
| Configuração de intensidade automática | Sim |
| Controle por gamepad | Posterior |
| Replays cinematográficos | Posterior |

### 14.16. Critérios de aceite da câmera

O sistema será considerado adequado para o MVP quando:

1. O jogador conseguir visualizar todas as áreas jogáveis da arena.
2. A câmera nunca alterar o estado oficial da partida.
3. O clique selecionar corretamente a mesma célula em qualquer rotação.
4. Objetos entre câmera e personagem não bloquearem permanentemente a visualização.
5. Andares diferentes forem compreensíveis visualmente.
6. A prévia de habilidades funcionar em todas as quatro rotações.
7. Alterar zoom ou rotação não revelar informações ocultas.
8. Eventos automáticos puderem ser interrompidos.
9. Reconexão reconstruir a câmera corretamente.
10. A câmera manter desempenho aceitável mesmo com transparência de obstáculos e efeitos ativos.

---

## 15. Roadmap de implementação

A Fase 1 será tratada como uma fase oficial do projeto, e não como uma “Fase 0”, porque já produz componentes permanentes e reutilizáveis: o núcleo de gameplay, o modelo de eventos, os testes automatizados e o ambiente interno de debug.

O Combat Debug Lab continuará existindo durante todo o projeto e será utilizado para validar novas magias, superfícies, objetos, IA, mapas e alterações de balanceamento antes de essas mudanças chegarem ao cliente 3D.

---

### Fase 1 — Core de Gameplay + Combat Debug Lab

**Objetivo:** construir as regras fundamentais do jogo e um ambiente visual 2D completo para criar, executar, inspecionar, reproduzir e testar cenários de combate.

#### Núcleo de gameplay

Inclui:

- Grid lógico.
- Coordenadas `x`, `y` e `floor`.
- Turnos e rodadas.
- PV, PA, PM e Foco.
- Armadura e resistências.
- Ataques básicos.
- Custos de ações.
- Cooldowns.
- Estados.
- Superfícies.
- Objetos interativos.
- Linha de visão.
- Pathfinding.
- Regras de altura e andares.
- Sistema de eventos.
- Sistema de comandos.
- Reações ambientais.
- Vitória, derrota e empate.
- Versionamento de regras e conteúdo.
- Simulação determinística.

O núcleo não dependerá de Babylon.js, banco de dados ou interface 3D.

#### Combat Debug Lab

Será criada uma aplicação interna dedicada ao desenvolvimento e validação do gameplay.

Estrutura sugerida:

```text
apps/
  combat-debug-lab/
    scenario-editor/
    grid-view/
    entity-inspector/
    cell-inspector/
    ability-panel/
    turn-controller/
    event-timeline/
    state-viewer/
    visibility-debug/
    pathfinding-debug/
    ai-debug/
    reactions-debug/
    network-debug/
    test-runner/
    screenshot-runner/
    replay/
```


#### Interface principal do Combat Debug Lab

O ambiente de debug terá uma interface de trabalho dividida em três áreas principais:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ TOOLBAR / CONTROLES DE EXECUÇÃO                                     │
├───────────────────┬───────────────────────────────┬───────────────────┤
│ ABA LATERAL       │ MAPA / GRID 2D               │ INSPECTOR / LOG   │
│                   │                               │                   │
│ Efeitos           │                               │ Estado            │
│ Itens             │          ARENA                │ Eventos           │
│ Magias            │                               │ Damage Log        │
│ Ataques           │                               │ Cura              │
│ Personagens       │                               │ Escudos           │
│ Objetos           │                               │ Mecânicas         │
│ Superfícies       │                               │                   │
├───────────────────┴───────────────────────────────┴───────────────────┤
│ TIMELINE / STEP / REPLAY / TEST                                     │
└───────────────────────────────────────────────────────────────────────┘
```

A aba lateral funcionará como uma biblioteca completa do conteúdo disponível no projeto.

Ela deverá permitir arrastar, clicar ou selecionar um recurso e aplicá-lo diretamente no cenário de teste.

#### Aba lateral de conteúdo

A lateral será organizada em categorias recolhíveis:

```text
CONTENT

▾ Personagens
▾ Bonecos de teste
▾ Ataques
▾ Magias
▾ Itens
▾ Efeitos
▾ Estados
▾ Superfícies
▾ Objetos de mapa
▾ Terrenos
▾ Mecânicas
```

Também haverá:

```text
[ Buscar conteúdo... ]

Filtros:
[ Classe ]
[ Tipo ]
[ Elemento ]
[ Tags ]
[ Fonte ]
```

Cada entrada deverá mostrar, no mínimo:

- Nome.
- ID interno.
- Ícone provisório ou definitivo.
- Categoria.
- Tags.
- Custo, quando aplicável.
- Tipo de alvo.
- Resumo do efeito.
- Versão da definição.

Exemplo:

```text
Chama concentrada
mage.flame

Classe: Mago
Custo: 1 PA + 2 Foco
Alcance: 6
Tags:
FIRE
PROJECTILE
HEAT
DAMAGE
STATUS

[ USAR ]
[ INSPECIONAR ]
```

#### Categoria — Ataques

A aba de ataques incluirá ações básicas e ataques independentes de magia.

Exemplos:

```text
Ataque de espada
Ataque de adaga
Disparo de arco
Ataque de varinha
Ataque de cajado
Ataque físico genérico
Dano direto de teste
```

O ataque de teste poderá ser configurado manualmente:

```text
Damage Type:
[ Physical ▼ ]

Amount:
[ 20 ]

Ignore Armor:
[ ] 

Apply Critical:
[ ]

Target:
[ Selected Unit ▼ ]

[ APPLY DAMAGE ]
```

Esse recurso será exclusivo do ambiente de debug e não fará parte do gameplay real.

#### Categoria — Magias

Todas as habilidades definidas no catálogo deverão aparecer automaticamente nessa aba.

O Debug Lab não manterá uma lista manual independente.

Fluxo:

```text
packages/content/abilities
↓
Catálogo carregado
↓
Combat Debug Lab
↓
Aba Magias
```

Assim, adicionar uma nova habilidade ao catálogo automaticamente a torna disponível para teste.

O usuário poderá:

- Selecionar a magia.
- Escolher o conjurador.
- Selecionar o alvo.
- Ignorar ou respeitar custos.
- Ignorar ou respeitar cooldown.
- Executar normalmente.
- Executar em modo STEP.
- Mostrar preview de alcance.
- Inspecionar operações internas.

Opções de debug:

```text
Execution Mode

(•) Regras normais
( ) Ignorar custo
( ) Ignorar cooldown
( ) Ignorar turno
( ) Forçar execução
```

O modo `Forçar execução` será claramente marcado como debug e nunca será utilizado pelo servidor normal.

#### Categoria — Itens

A lateral deverá permitir:

- Equipar item.
- Remover item.
- Adicionar consumível.
- Consumir item.
- Aplicar efeito de item.
- Alterar quantidade.
- Inspecionar definição.

Exemplo:

```text
Poção de Vida

heal: 24
cost: 1 PA
target: SELF

[ DAR AO PERSONAGEM ]
[ USAR AGORA ]
[ INSPECIONAR ]
```

#### Categoria — Efeitos

"Efeitos" serão operações de baixo nível utilizadas para testar o motor diretamente.

Exemplos:

```text
Damage
Heal
Shield
Apply Status
Remove Status
Create Surface
Remove Surface
Force Move
Restore Resource
Emit Heat
Emit Cold
Emit Water
Destroy Object
Change Object State
```

Isso permitirá testar uma mecânica isoladamente sem precisar criar uma magia temporária.

Exemplo:

```text
Effect: grantShield

Amount:
[ 15 ]

Duration:
[ Next own turn ▼ ]

Target:
[ Dummy-01 ▼ ]

[ APPLY ]
```

#### Categoria — Estados

Os estados poderão ser adicionados ou removidos manualmente.

Exemplos:

```text
Burning
Slowed
Rooted
Hidden
Shielded
```

Ao aplicar um estado, o debug poderá solicitar parâmetros:

```text
Status:
Burning

Source:
Mage-01

Duration:
2 target turn starts

Stacks:
1

[ APPLY STATUS ]
```

#### Categoria — Superfícies

O usuário poderá pintar superfícies diretamente no grid:

```text
Normal
Oil
Fire
Thorns
Water
```

Ferramentas:

```text
[ Pincel 1 célula ]
[ Pincel 3x3 ]
[ Linha ]
[ Área ]
[ Preencher conectadas ]
[ Apagar ]
```

Superfícies poderão ser aplicadas em modo:

```text
(•) Direto
( ) Via evento de gameplay
```

No modo direto, o estado é alterado imediatamente para preparação de cenário.

No modo por evento, o Debug Lab envia uma operação ao core para permitir testar reações e logs.

#### Categoria — Mecânicas

Essa área agrupará testes que não correspondem necessariamente a uma magia ou item.

Exemplos:

```text
Start Turn
End Turn
Advance Round
Trigger Surface
Trigger Reaction
Check Line of Sight
Calculate Path
Force Move
Open Door
Close Door
Destroy Object
Ignite Cell
Extinguish Cell
Reveal Unit
Hide Unit
```

Cada mecânica poderá ser executada diretamente e registrar todos os eventos produzidos.

---

#### Boneco de teste instrumentado

O Combat Debug Lab terá uma entidade específica chamada:

```text
TEST DUMMY
```

ou, internamente:

```text
debug.test-dummy
```

Esse boneco servirá como alvo controlado para validar dano, cura, escudo, estados, resistências, interações ambientais e outras mecânicas.

Ele será uma entidade de debug e não fará parte do conteúdo normal do jogo.

##### Criação do boneco

Na aba lateral:

```text
▾ Bonecos de teste

Test Dummy — Padrão
Test Dummy — Armadura Alta
Test Dummy — Resistente a Fogo
Test Dummy — Resistente a Frio
Test Dummy — Sem Resistência

[ + CUSTOM DUMMY ]
```

O usuário poderá arrastar um boneco para qualquer célula válida.

##### Configuração do boneco

O inspector permitirá alterar:

```text
Name:
Dummy-01

HP:
100 / 100

Armor:
0

Fire Resistance:
0

Cold Resistance:
0

Nature Resistance:
0

Arcane Resistance:
0

Shield:
0

Movement:
Disabled

AI:
None
```

Também poderão ser configurados:

- Imortal.
- Pode morrer.
- Regenerar vida automaticamente.
- Limpar estados após cada teste.
- Resetar escudo após cada teste.
- Manter histórico.
- Bloquear movimento.
- Permitir empurrão.
- Permitir estados.
- Permitir efeitos ambientais.

##### Presets

Presets propostos:

| Preset | Configuração |
|---|---|
| Dummy padrão | 100 PV, armadura 0, resistências 0 |
| Dummy blindado | 100 PV, armadura 10 |
| Dummy resistente ao fogo | 100 PV, resistência a fogo 10 |
| Dummy frágil | 50 PV, sem mitigação |
| Dummy imortal | Não pode ficar abaixo de 1 PV |
| Dummy ambiental | Sem movimento, aceita todas as superfícies e estados |

##### Registro de dano

O boneco manterá um histórico detalhado:

```text
DAMAGE LOG

#001
Source:
Mage-01

Ability:
mage.flame

Raw Damage:
18

Type:
FIRE

Resistance:
2

Mitigated:
2

Shield Absorbed:
5

HP Damage:
11

HP:
100 -> 89
```

Resumo acumulado:

```text
Total Raw Damage:       74
Total Mitigated:        12
Total Shield Absorbed:  18
Total HP Damage:        44
Largest Hit:            22
Hits Received:          5
```

##### Registro de cura

```text
HEAL LOG

Source:
Druid-01

Ability:
druid.natural_heal

Requested Heal:
24

Effective Heal:
17

Overheal:
7

HP:
83 -> 100
```

Resumo:

```text
Total Healing Requested:  52
Effective Healing:         39
Overheal:                  13
```

##### Registro de escudo

```text
SHIELD LOG

Source:
Mage-01

Effect:
Arcane Barrier

Granted:
18

Previous Shield:
0

Current Shield:
18
```

Ao receber dano:

```text
Incoming Damage:
14

Shield Before:
18

Absorbed:
14

Shield After:
4

HP Damage:
0
```

##### Registro de estados

```text
STATUS LOG

APPLIED
Burning

Source:
Mage-01

Duration:
2 target turn starts

Event:
#00047
```

Depois:

```text
TICK
Burning

Damage:
4

Remaining:
1
```

E:

```text
REMOVED
Burning

Reason:
Cold Effect
```

##### Registro de mecânicas

O boneco também registrará eventos não relacionados diretamente a dano.

Exemplos:

```text
FORCED_MOVE
from: (4,4,0)
to:   (4,6,0)
source: warrior.push
```

```text
SURFACE_ENTER
surface: FIRE
cell: (4,6,0)
```

```text
LINE_OF_SIGHT
visible: false
reason: WALL_BLOCK
```

```text
ROOT_ATTEMPT
result: APPLIED
```

```text
MOVE_ATTEMPT
result: BLOCKED
reason: ROOTED
```

##### Métricas do boneco

O painel poderá mostrar:

```text
TEST SUMMARY

Damage Received        44
Healing Received       39
Shield Generated       32
Shield Absorbed        28
Statuses Applied        6
Statuses Removed        4
Forced Moves            2
Surface Triggers        3
Deaths                   0
```

##### Reset rápido

Botões:

```text
[ RESET HP ]
[ RESET SHIELD ]
[ CLEAR STATES ]
[ CLEAR LOGS ]
[ FULL RESET ]
```

O `FULL RESET` retorna o boneco ao preset original.

##### Comparação de testes

Será possível colocar mais de um boneco lado a lado.

Exemplo:

```text
Dummy A
Armor: 0

Dummy B
Armor: 10

Dummy C
Fire Resistance: 10
```

Usar a mesma habilidade nos três permitirá comparar imediatamente:

```text
            RAW    MITIGATION    HP DAMAGE

Dummy A      18        0             18
Dummy B      18        0             18
Dummy C      18       10              8
```

Isso será especialmente útil para balanceamento.

---

#### Painel de execução rápida

Além da lateral, haverá uma área de execução rápida para o objeto atualmente selecionado.

Exemplo para `Dummy-01`:

```text
QUICK ACTIONS

[ Deal Damage ]
[ Heal ]
[ Add Shield ]
[ Apply Status ]
[ Push ]
[ Ignite Cell ]
[ Extinguish ]
[ Kill ]
[ Reset ]
```

Essas ações deverão utilizar as mesmas operações do core sempre que possível.

---

#### Registro global do cenário

Além dos logs individuais do boneco, existirá um log geral:

```text
GLOBAL EVENT LOG

#001 COMMAND_USE_ABILITY
#002 SPEND_RESOURCE
#003 DAMAGE_CALCULATED
#004 DAMAGE_APPLIED
#005 STATUS_APPLIED
#006 SURFACE_CREATED
#007 REACTION_TRIGGERED
```

Ao clicar em um evento, o usuário poderá ver:

- Estado antes.
- Payload do evento.
- Estado depois.
- Entidades envolvidas.
- Origem da regra.
- Definição responsável.

Exemplo:

```text
Event:
#005 STATUS_APPLIED

Definition:
status.burning

Source:
mage-01

Target:
dummy-01

Caused by:
mage.flame

Rule Version:
1
```

---

#### Uso do boneco em testes automatizados

O Test Dummy também poderá fazer parte dos cenários salvos.

Exemplo:

```text
tests/scenarios/spells/mage_flame_vs_fire_resistance/
```

`initial.json`:

```json
{
  "entities": [
    {
      "id": "dummy-01",
      "type": "debug.test-dummy",
      "hp": 100,
      "resistances": {
        "fire": 10
      }
    }
  ]
}
```

`commands.json`:

```json
[
  {
    "type": "USE_ABILITY",
    "actorId": "mage-01",
    "abilityId": "mage.flame",
    "targetId": "dummy-01"
  }
]
```

`expected.json` poderá validar:

```text
Raw Damage = 18
Fire Resistance = 10
HP Damage = 8
Final HP = 92
Burning = Applied
```

O mesmo cenário poderá gerar screenshot para inspeção visual.

---

#### Objetivo da aba lateral

A aba lateral não será apenas uma coleção visual de botões.

Ela funcionará como um navegador do catálogo real do jogo.

Isso permitirá que, ao chegar a cem magias, centenas de itens ou dezenas de estados, o Debug Lab continue útil através de:

- Busca.
- Filtros.
- Tags.
- Classes.
- Elementos.
- Categorias.
- Favoritos de debug.
- Histórico recente.

A intenção é permitir que qualquer nova mecânica seja testada no laboratório antes de receber acabamento 3D.

#### Modos principais

```text
[ EDIT ]
[ PLAY ]
[ STEP ]
[ REPLAY ]
[ TEST ]
[ AI ]
[ NETWORK ]
```

##### EDIT

Permite construir cenários manualmente.

O usuário poderá:

- Pintar terreno.
- Pintar superfícies.
- Colocar personagens.
- Colocar objetos.
- Posicionar paredes.
- Adicionar portas.
- Adicionar barris.
- Adicionar caixas.
- Criar áreas escuras.
- Configurar pontos de início.
- Definir andar.
- Alterar PV, Foco, estados e outros parâmetros de teste.

Exemplo de paleta:

```text
Terrain
Ground
Wall
Void

Surface
Oil
Fire
Thorns
Water

Objects
Barrel
Door
Box

Units
Mage
Rogue
Warrior
Druid
```

##### PLAY

Permite executar o cenário como uma partida simplificada em 2D usando exatamente as mesmas regras do core.

##### STEP

Executa uma ação evento por evento.

Exemplo:

```text
01 USE_ABILITY
02 SPEND_RESOURCE
03 DAMAGE
04 EMIT_HEAT
05 OIL_IGNITED
06 FIRE_CREATED
07 BARREL_TRIGGERED
08 EXPLOSION
09 OBJECT_DESTROYED
```

O mapa poderá ser visualizado após cada evento.

##### REPLAY

Permite reproduzir uma sequência de comandos já executada.

O replay será baseado em comandos e eventos do domínio, não em gravação de vídeo.

##### TEST

Executa cenários automatizados e compara:

- Estado esperado.
- Estado obtido.
- Eventos esperados.
- Eventos obtidos.
- Screenshots esperados.
- Screenshots obtidos.

##### AI

Exibe como o bot avaliou possíveis ações.

Exemplo:

```text
Attack enemy        +32
Move to cover       +18
Ignite barrel       +51
Heal                 +9
Walk into fire      -40
```

Esse modo será implementado inicialmente com estrutura preparada, mesmo que a IA completa seja adicionada em uma fase posterior.

##### NETWORK

Será utilizado posteriormente para comparar:

```text
SERVER STATE
CLIENT A VIEW
CLIENT B VIEW
```

O objetivo será descobrir vazamento de informações, divergências de estado ou problemas de sincronização.

#### Visualizador 2D

O estado do jogo será representado através de grids coloridos e símbolos.

Exemplo:

```text
┌───┬───┬───┬───┬───┐
│   │ O │ O │ O │   │
├───┼───┼───┼───┼───┤
│ M │ O │ F │ B │   │
├───┼───┼───┼───┼───┤
│   │   │ G │   │   │
└───┴───┴───┴───┴───┘

O = óleo
F = fogo
B = barril
M = mago
G = guerreiro
```

O visualizador não calculará nenhuma regra.

Fluxo:

```text
Core
↓
Game State
↓
Debug Renderer
↓
Visualização 2D
```

#### Layers de debug

O usuário poderá ativar ou desativar camadas.

```text
LAYERS

Terrain
Surface
Characters
Objects

DEBUG

Coordinates
Movement Cost
Line of Sight
Attack Range
Pathfinding
Light
AI Evaluation
```

Exemplo de custo de movimento:

```text
┌───┬───┬───┐
│ 1 │ 1 │ 1 │
├───┼───┼───┤
│ 1 │ 2 │ 2 │
├───┼───┼───┤
│ 1 │ 2 │ 1 │
└───┴───┴───┘
```

#### Inspector de células

Ao selecionar uma célula:

```text
Cell:
(7,4,0)

Terrain:
STONE

Surface:
FIRE

Surface source:
mage.flame

Created:
round 3

Expires:
round 6

Movement cost:
1

Blocks vision:
false

Occupant:
warrior-01
```

#### Inspector de entidades

Exemplo de barril:

```text
Object:
barrel-03

HP:
8 / 8

Material:
WOOD

Tags:
FLAMMABLE
EXPLOSIVE

State:
NORMAL

Triggers:
FIRE -> EXPLODE
HP <= 0 -> EXPLODE
```

#### State Diff

O laboratório mostrará alterações entre dois estados.

```text
ANTES                DEPOIS

HP: 90               HP: 70
Focus: 8             Focus: 6
Surface: Oil         Surface: Fire
Door: Closed         Door: Destroyed
```

#### Testes visuais

Cada cenário importante poderá gerar screenshots.

Exemplo:

```text
tests/output/surfaces/

oil_before.png
oil_after_fire.png
oil_after_round_1.png
oil_after_round_2.png
oil_after_round_3.png
```

Isso permitirá visualizar a evolução do cenário ao longo da simulação.

#### Estrutura de cenários

```text
tests/
  scenarios/
    surfaces/
    spells/
    movement/
    explosions/
    visibility/
    environment/
```

Exemplo:

```text
tests/scenarios/surfaces/oil_ignition/

initial.json
commands.json
expected.json
```

#### Criar teste a partir do editor

O usuário poderá:

```text
Criar cenário
↓
Executar ações
↓
Validar visualmente
↓
Salvar estado atual como resultado esperado
↓
Gerar teste automatizado
```

Arquivos gerados:

```text
initial.json
commands.json
expected.json
```

#### Teste de interação exemplo

Cenário:

```text
óleo em:
(4,4)
(4,5)
(4,6)
```

Ação:

```text
HEAT em (4,5)
```

Resultado esperado:

```text
(4,4) = FIRE
(4,5) = FIRE
(4,6) = FIRE

duration = 3 rounds
```

O teste deverá validar tanto o estado quanto os eventos gerados.

#### Screenshots em testes automatizados

Os testes poderão gerar:

```text
before.png
after_action.png
after_round_1.png
after_round_2.png
final.png
```

O objetivo principal não será fazer comparação visual como única fonte de verdade.

A validação principal continuará sendo feita pelos dados do estado.

Os screenshots servirão para:

- Inspeção humana.
- Relatórios de regressão.
- Comparação visual.
- Documentação de mecânicas.
- Identificação rápida de comportamento inesperado.

#### Critério de conclusão da Fase 1

| Critério | Obrigatório |
|---|---|
| Grid lógico | Sim |
| Turnos | Sim |
| Sistema de dano | Sim |
| Recursos | Sim |
| Estados | Sim |
| Superfícies | Sim |
| Reações ambientais | Sim |
| Objetos ambientais | Sim |
| Movimento | Sim |
| Linha de visão | Sim |
| Visualizador 2D | Sim |
| Editor de cenário | Sim |
| Inspector | Sim |
| Timeline de eventos | Sim |
| Modo STEP | Sim |
| Replay de comandos | Sim |
| Testes automatizados | Sim |
| Geração de screenshots | Sim |
| Exportação de cenário | Sim |
| Criar teste a partir de cenário | Sim |
| Aba lateral de conteúdo | Sim |
| Test Dummy instrumentado | Sim |
| Logs de dano, cura e escudo | Sim |
| Execução direta de efeitos | Sim |

**Resultado esperado:** ser possível criar e validar uma mecânica completa sem utilizar o cliente 3D.

---

### Fase 2 — Arena visual 3D mínima

**Objetivo:** conectar o core validado ao cliente Babylon.js.

Inclui:

- Babylon.js.
- Cena 3D.
- Grid invisível conectado ao mundo.
- Câmera tática.
- Raycast.
- Seleção.
- Movimento visual.
- Personagens provisórios.
- Animações básicas.
- Interface de combate.
- Barras de recursos.
- Destaque de alcance.
- Destaque de área.
- Primeiro mapa 3D.
- Portas.
- Barris.
- Óleo.
- Fogo.
- Escadas.
- Plataformas.
- Tratamento visual dos andares.
- Oclusão da câmera.

O cliente 3D consumirá o mesmo core utilizado pelo Combat Debug Lab.

**Critério de aprovação:** uma partida completa poderá ser executada localmente no cliente 3D controlando os dois lados.

---

### Fase 3 — Multiplayer local

**Objetivo:** provar a arquitetura cliente-servidor autoritativa.

Inclui:

- Node.js.
- Colyseus.
- WebSocket.
- Salas.
- Duas contas.
- Turnos sincronizados.
- Validação de comandos.
- `commandId`.
- Proteção contra repetição.
- Timer.
- Reconexão.
- PostgreSQL local.
- Persistência básica.
- Snapshots.
- Registro de comandos.
- Registro de eventos.
- Visão individual.
- Ocultação de informações.
- Validação de linha de visão no servidor.

O Combat Debug Lab começará a utilizar o modo `NETWORK` para comparar estado oficial e visão individual dos clientes.

**Critério de aprovação:** dois clientes locais deverão completar uma partida sem divergência de estado e sem o cliente controlar resultados oficiais.

---

### Fase 4 — Conteúdo completo do MVP

**Objetivo:** implementar todo o conteúdo definido para a primeira versão.

Inclui:

- Quatro classes.
- Dez habilidades.
- Quatorze itens.
- Consumíveis.
- Equipamentos.
- Acessórios.
- Estados.
- Superfícies.
- Reações.
- Barris.
- Portas destrutíveis.
- Caixas.
- Cisternas.
- Altares.
- Baús.
- Áreas escuras.
- Ícones.
- Modelos.
- Animações.
- VFX.
- SFX principais.
- Feedback de dano.
- Feedback de estados.
- Cooldowns.
- Definições de conteúdo por dados.

Toda nova habilidade deverá possuir cenários de teste correspondentes no Combat Debug Lab.

**Critério de aprovação:** todo o conteúdo do MVP deverá possuir comportamento verificável tanto no Combat Debug Lab quanto no cliente 3D.

---

### Fase 5 — Ciclo completo do jogo

**Objetivo:** transformar o combate isolado em uma experiência completa.

Inclui:

- Login.
- Conta.
- Sessão.
- Criação de personagem.
- Aparência.
- Seleção de classe.
- Inventário.
- Equipamento.
- Lobby.
- Convites.
- Matchmaking.
- Partidas contra bot.
- Bot fácil.
- Bot normal.
- Bot difícil.
- Loja.
- Moedas.
- Recompensas.
- Missões.
- Histórico de partidas.
- Tela de resultado.
- Retorno ao lobby.
- Salvamento de progresso.

Fluxo:

```text
Login
↓
Personagem
↓
Lobby
↓
Matchmaking / Bot
↓
Partida
↓
Resultado
↓
Recompensa
↓
Lobby
```

**Critério de aprovação:** um jogador deverá conseguir completar todo o ciclo sem intervenção manual do desenvolvedor.

---

### Fase 6 — Validação técnica e balanceamento

**Objetivo:** testar estabilidade, desempenho e qualidade das regras.

Inclui:

- Testes de desempenho.
- Testes de rede.
- Reconexão.
- Desync.
- Exploits.
- Segurança do cliente.
- Matchmaking.
- Ocultação de informações.
- Testes de todas as habilidades.
- Testes de superfícies.
- Testes de interações ambientais.
- Testes automatizados em lote.
- Balanceamento.
- Ajustes de dano.
- Ajustes de custos.
- Ajustes de cooldown.
- Ajustes do mapa.
- Ajustes da IA.
- Ajustes da câmera.
- Otimização de modelos.
- Otimização de texturas.
- Otimização de VFX.

O Combat Debug Lab será usado para reproduzir bugs encontrados pelos jogadores e convertê-los em testes de regressão.

**Critério de aprovação:** não deverão existir divergências conhecidas de estado, vazamentos críticos de informações ou interações principais sem cobertura de testes.

---

### Fase 7 — Teste externo do MVP

**Objetivo:** descobrir se o jogo é divertido, compreensível e possui potencial para evolução.

Inclui:

- Distribuição para grupo controlado de jogadores.
- Coleta de métricas.
- Feedback dos usuários.
- Análise de duração das partidas.
- Taxa de vitória por classe.
- Uso das habilidades.
- Uso das interações ambientais.
- Taxa de abandono.
- Revanche.
- Problemas de interface.
- Problemas de câmera.
- Percepção de equilíbrio.
- Avaliação dos bots.

Métricas principais:

- Duração média da partida.
- Tempo médio por turno.
- Classe mais utilizada.
- Taxa de vitória por classe.
- Habilidade mais utilizada.
- Habilidade menos utilizada.
- Quantidade de explosões e interações ambientais.
- Taxa de abandono.
- Taxa de revanche.
- Partidas contra bot.
- Retorno de jogadores.

**Critério de aprovação:** decidir, com base em dados e feedback, se o projeto deve avançar para beta e expansão de conteúdo.

---

### Resumo das fases

| Fase | Pergunta principal |
|---|---|
| 1 — Core + Debug Lab | As regras funcionam e conseguimos testá-las rapidamente? |
| 2 — Arena 3D | O combate funciona e é compreensível visualmente no jogo real? |
| 3 — Multiplayer | Dois jogadores conseguem jogar com segurança e sincronização? |
| 4 — Conteúdo | Todo o conteúdo planejado funciona em conjunto? |
| 5 — Ciclo completo | Já existe um produto jogável do login à recompensa? |
| 6 — Validação | O sistema está estável, testado e razoavelmente equilibrado? |
| 7 — Teste externo | O jogo é divertido e vale a pena expandir? |

## 16. Objetivo técnico da primeira versão executável

A primeira versão deve permitir:

1. Dois jogadores entrarem na arena.
2. Selecionarem personagens.
3. Movimentarem-se em turnos.
4. Subirem e descerem níveis.
5. Abrirem uma porta.
6. Utilizarem habilidades.
7. Incendiarem óleo.
8. Detonarem um barril.
9. Destruírem um obstáculo.
10. Utilizarem linha de visão.
11. Finalizarem uma partida.
12. Terem o resultado persistido.
13. Receberem recompensas.
14. Retornarem ao lobby.

Esse ponto será o principal marco de validação antes de ampliar o conteúdo.

---

## 17. Princípios de arquitetura

1. **O servidor é sempre a autoridade.**
2. **O cliente envia intenções, não resultados.**
3. **Gameplay e apresentação visual são independentes.**
4. **Magias são compostas por operações reutilizáveis.**
5. **Reações ambientais pertencem a um sistema próprio.**
6. **Conteúdo deve ser configurável e versionado.**
7. **Cada partida usa uma versão imutável das regras.**
8. **O banco de dados não decide regras de gameplay.**
9. **O bot usa as mesmas ações disponíveis para jogadores.**
10. **Informações ocultas nunca são enviadas ao cliente adversário.**
11. **O código do domínio não depende diretamente da engine gráfica.**
12. **A arquitetura deve permitir expansão para dezenas ou centenas de habilidades sem criar um sistema independente para cada uma.**
