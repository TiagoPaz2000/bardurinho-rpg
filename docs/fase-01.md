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
| Estados | 🟡 | Queimando, Lentidão, Enraizado completos. Oculto: só a definição (depende de visibilidade) |
| Superfícies | ✅ | Óleo, fogo, espinhos; custo de entrada; dano 1×/turno global; exposição na criação; expiração em R + N |
| Reações ambientais | ✅ | Calor+óleo (mancha conectada), calor+espinhos, calor+madeira, fogo+barril, frio/água apagam fogo e Queimando, óleo sobre fogo |
| Objetos ambientais | ✅ | Porta, portão+alavanca, barril (cadeia de explosões), caixa, baú, cisterna, altar |
| Movimento | ✅ | 4 direções, Dijkstra, escadas com custo 2, deslocamento forçado |
| Linha de visão | 🟡 | Mesmo andar completo. Entre andares: aproximação provisória. Visão de 8 células e áreas escuras ainda não aplicadas |
| Visualizador 2D | ✅ | Canvas; não calcula regras |
| Editor de cenário | 🟡 | Terreno, área escura, superfícies, personagens, bonecos, objetos. Falta: escadas, andares e pontos de início pela UI |
| Inspector | ✅ | Célula, unidade, objeto (gatilhos, tags, usos) |
| Timeline de eventos | ✅ | Log global com causa, definição, payload e State Diff |
| Modo STEP | 🟡 | Por comando. Falta snapshot por evento individual |
| Replay de comandos | ✅ | Reexecuta do zero e confirma determinismo |
| Testes automatizados | ✅ | 36 testes, incluindo 5 cenários JSON |
| Geração de screenshots | ⬜ | Pendente (renderizar canvas em Node ou via navegador headless) |
| Exportação de cenário | ✅ | Exportar e importar `initial.json` |
| Criar teste a partir de cenário | ✅ | GERAR TESTE; coberto por `tests/unit/lab-session.test.ts` |
| Aba lateral de conteúdo | 🟡 | Gerada a partir do catálogo, com busca por nome, id ou tag. Faltam filtros dedicados, favoritos e histórico |
| Test Dummy instrumentado | 🟡 | 7 presets, logs, métricas, comparação, reset. Faltam regeneração automática e limpeza automática entre testes |
| Logs de dano, cura e escudo | ✅ | Derivados dos eventos do core |
| Execução direta de efeitos | ✅ | `DEBUG_APPLY_EFFECTS` com as mesmas operações do core |

### Também pendente nesta fase

- **Investida** (`warrior.charge`) e **Ocultação** (`rogue.hide`): exigem mecânicas novas (deslocamento + ataque; visibilidade). Por isso ainda não estão no catálogo, que tem 8 das 10 habilidades.
- Modos **AI** e **NETWORK** do laboratório: estrutura prevista, implementação junto das Fases 3 e 4.

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
