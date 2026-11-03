# Fase 1 — Core de Gameplay + Combat Debug Lab

Acompanhamento da implementação da Fase 1 do [plano do MVP](plano_mvp_rpg_tatico.md) (seção 15).

**Objetivo:** criar e validar uma mecânica completa sem utilizar o cliente 3D.

## Estrutura criada

```text
packages/
  domain/        Núcleo de regras (sem Babylon, Colyseus, banco ou DOM)
    src/core/        Coordenadas, distância, tipos de dano, RULES_VERSION
    src/map/         Grid, linha de visão (supercover), pathfinding (Dijkstra)
    src/rules/       Tipos das definições de conteúdo e das operações reutilizáveis
    src/state/       GameState, eventos, contexto de resolução, fábricas, consultas
    src/combat/      Dano, mitigação, barreira, cura, derrota
    src/effects/     Operações (ops), estados, superfícies, reações ambientais, movimento
    src/turns/       Turnos, rodadas, vitória/derrota/empate
    src/commands/    Comandos (intenções) e processador validar → simular → confirmar
    src/scenario/    Formato initial/commands/expected, execução, exportação
  content/       Catálogo versionado: classes, habilidades, itens, estados, superfícies, objetos, bonecos
  protocol/      Envelope de rede dos comandos (protocolVersion, commandId) — integração na Fase 3
apps/
  combat-debug-lab/  Aplicação interna 2D (Vite + TypeScript, sem framework)
tests/
  unit/          Regras isoladas e sessão do laboratório
  scenarios/     Cenários JSON executados automaticamente
tools/
  validate-content/  Validação de referências do catálogo
```

## Como usar

```bash
npm install
npm test                 # testes unitários + todos os cenários em tests/scenarios
npm run typecheck        # tsc -b em todos os projetos
npm run validate-content # valida o catálogo
npm run lab              # Combat Debug Lab em http://127.0.0.1:5174
```

No laboratório:

- **Clique** numa unidade para selecioná-la; clique numa célula livre para movê-la.
- **USAR** numa entrada da lateral arma a ação; o próximo clique no grid aplica. Botão direito ou `Esc` cancela.
- Magias com alvo "self" executam imediatamente no personagem selecionado.
- `E` encerra o turno; `←`/`→` fazem STEP pela timeline.
- **GERAR TESTE** baixa `initial.json`, `commands.json` e `expected.json`; basta colocá-los em `tests/scenarios/<categoria>/<nome>/`.
- Edições de terreno/unidades/objetos alteram a preparação e reiniciam a timeline.

## Critérios de conclusão

| Critério | Status | Observação |
|---|---|---|
| Grid lógico | ✅ | `x`, `y`, `floor`; mapas por ASCII |
| Turnos | ✅ | Turnos, rodadas, ordem, limite de 20 rodadas. Cronômetro de 45 s fica no servidor (Fase 3) |
| Sistema de dano | ✅ | Armadura/resistência → barreira → PV; imortalidade de boneco |
| Recursos | ✅ | PV, PA, PM, Foco (+2/turno), custos, recargas, usos por turno |
| Estados | ✅ | Queimando, Lentidão, Enraizado e Oculto |
| Superfícies | ✅ | Óleo, fogo, espinhos; custo de entrada; dano 1×/turno global; exposição na criação; expiração em R + N |
| Reações ambientais | ✅ | Calor+óleo (mancha conectada), calor+espinhos, calor+madeira, fogo+barril, frio/água apagam fogo e Queimando, óleo sobre fogo |
| Objetos ambientais | ✅ | Porta, portão+alavanca, barril (cadeia de explosões), caixa, baú, cisterna, altar |
| Movimento | ✅ | 4 direções, Dijkstra, escadas com custo 2, deslocamento forçado |
| Linha de visão | ✅ | Mesmo andar e entre andares: altura do corpo (andar + 0,5); lajes de plataforma bloqueiam (`FLOOR_BLOCK`); do alto, enxerga por cima de muros |
| Visibilidade | ✅ | Visão de 8 células, áreas escuras (2 células), luz do fogo (2 células), visão por equipe e projeção do estado (`projectStateForTeam`); no lab, botões Visão: Servidor / Equipe A / Equipe B |
| Visualizador 2D | ✅ | Canvas; não calcula regras |
| Editor de cenário | ✅ | Terreno, área escura, superfícies, personagens, bonecos, objetos, **andares (+/−) e escadas**; mapas do catálogo (Pátio das Ruínas). Pontos de início = posições das unidades |
| Inspector | ✅ | Célula, unidade, objeto (gatilhos, tags, usos) |
| Timeline de eventos | ✅ | Log global com causa, definição, payload e State Diff |
| Modo STEP | ✅ | Por comando e **por evento**: snapshot do estado após cada evento (`captureEventSnapshots`, só debug); botões ◀ evento / evento ▶, atalhos `,` e `.` |
| Replay de comandos | ✅ | Reexecuta do zero e confirma determinismo |
| Testes automatizados | ✅ | 77 testes, incluindo 5 cenários JSON |
| Geração de screenshots | ✅ | `npm run screenshots` (ou `npm run test:screenshots` / `SCREENSHOTS=1 npm test`) renderiza cada cenário com o renderer do Debug Lab via `@napi-rs/canvas`: `before.png`, `after_command_<n>.png`, `final.png` em `tests/output/<categoria>/<nome>/` + galeria `tests/output/index.html` |
| Exportação de cenário | ✅ | Exportar e importar `initial.json` |
| Criar teste a partir de cenário | ✅ | GERAR TESTE; coberto por `tests/unit/lab-session.test.ts` |
| Aba lateral de conteúdo | ✅ | Gerada do catálogo; busca, filtros por classe e elemento, ★ favoritos e histórico recente (salvos no navegador), ícones de itens |
| Test Dummy instrumentado | ✅ | 7 presets, logs, métricas, comparação, reset; opções: imortal, regenerar, limpar estados/escudo após cada comando, bloquear empurrão/estados/superfícies |
| Logs de dano, cura e escudo | ✅ | Derivados dos eventos do core |
| Execução direta de efeitos | ✅ | `DEBUG_APPLY_EFFECTS` com as mesmas operações do core |

**Status:** todos os critérios de conclusão da Fase 1 estão atendidos. O catálogo tem as 10 habilidades do plano e o mapa do MVP (Pátio das Ruínas).

### Fica para as próximas fases

- **Filtragem de eventos por equipe**: a projeção já remove unidades não detectadas do estado; filtrar os eventos entra com o servidor (Fase 3).
- Modos **AI** e **NETWORK** do laboratório: estrutura prevista, implementação junto das Fases 3 e 4.

## Dados (RNG) no combate

Decisão posterior ao plano original (que previa combate sem aleatoriedade no MVP):

| Regra | Definição |
|---|---|
| Dados | d4, d6, d8, d10, d12, d20; fórmulas como `2d6+10` |
| Gerador | Semente + contador no estado da partida: mesma semente e mesmos comandos = mesmas rolagens (replay, testes, servidor) |
| Jogada de ataque | d20 + bônus de ataque ≥ Defesa do alvo. 1 natural erra sempre; 20 natural é crítico (dados de dano em dobro, bônus uma vez) |
| Quem rola ataque | Ataques com arma e habilidades com `attackRoll` (Chama, Geada, Tiro preciso, Investida, Empurrão, Enraizar) contra personagens |
| Objetos | Atingidos automaticamente (barris, portas, caixas) |
| Erro | O personagem errado não recebe dano nem estados; efeitos na célula (calor, superfícies) acontecem mesmo assim |
| Curas | Cura natural e Poção de vida `4d6+8`; Poção de Foco e altar `1d4+1` |
| Iniciativa | d20 por personagem no início (`initiative: 'roll'`); empate mantém a ordem original; bonecos no fim |
| Modo "média fixa" | Cada dado vale a média arredondada para cima (d4=3 … d20=11); padrão dos cenários de teste, para testar regras sem sorte |
| Debug | `DEBUG_SET_RNG`: modo, semente e próximos resultados forçados (barra "Dados" do lab) |

Valores iniciais (hipóteses de balanceamento):

| Classe | Defesa | Bônus de ataque |
|---|---:|---:|
| Mago | 11 | +5 |
| Ladino | 13 | +6 |
| Guerreiro | 14 | +5 |
| Druida | 12 | +5 |

| Ataque | Fórmula | Média | Antes (fixo) |
|---|---|---:|---:|
| Espada de ferro | 1d8+13 | 17,5 | 18 |
| Adaga | 1d6+12 | 15,5 | 16 |
| Arco curto / Varinha | 1d6+10 | 13,5 | 14 |
| Cajado | 1d4+9 | 11,5 | 12 |
| Chama concentrada | 2d6+10 | 17 | 18 |
| Raio de geada | 1d8+9 | 13,5 | 14 |
| Tiro preciso | 1d12+15 | 21,5 | 22 |
| Investida | 1d8+11 | 15,5 | 16 |
| Empurrão | 1d4+3 | 5,5 | 6 |
| Enraizar | 1d6+4 | 7,5 | 8 |

Com acerto de ~55–75%, o dano médio por ataque cai em relação ao combate sem dados — rever PV e custos na Fase 6 (balanceamento).

## Hipóteses assumidas (não definidas no plano)

Valores marcados para revisão de balanceamento:

| Ponto | Decisão provisória |
|---|---|
| Duração do Espinheiro | 3 rodadas |
| Dano de combustão de objetos (porta, caixa) | 6 de fogo por início de rodada |
| Área da explosão de barril | Quadrado 3×3 no mesmo andar, exige linha de visão a partir do barril |
| Área da cisterna | Cruz (5 células) centrada na cisterna |
| Fogo criado sobre espinhos | Também incendeia óleo vizinho |
| Unidades bloqueiam linha de visão? | Não |
| Bonecos de teste | Têm turno na ordem (para Queimando ticar), encerrado automaticamente; não contam para vitória |
| Escudo igual ao atual | Substitui (renova a duração) |
| Investida e destino | Vai para a célula adjacente ao alvo de menor custo (desempate: cima, direita, baixo, esquerda) |
| Investida enraizado | Bloqueada, exceto se já estiver adjacente ao alvo |
| Detecção de Oculto | Só a até 1 célula (adjacente) ou quando iluminado |
| Fontes de luz | Fogo no chão, objetos em combustão e personagens Queimando |
| Linha de visão entre andares | Origem e destino na altura do corpo (andar + 0,5); atravessar um nível exige célula vazia no andar de cima; na borda exata, basta uma célula livre |
| Pátio das Ruínas | Plataformas como mirantes (uma escada cada), sobre o muro central; muro com 2 portas e portão; alavanca em (8,6) |
| Opções do boneco | Aplicadas ao fim de cada comando |
| Revelação | Verificada após cada comando: um inimigo que detecta o Oculto encerra o efeito |
| Alvo não detectado | Não pode ser mirado diretamente (`TARGET_NOT_VISIBLE`), mas a célula pode — ataque "às cegas" |
| Superfícies e objetos na projeção | Conhecidos por todas as equipes no MVP (sem memória de neblina) |
