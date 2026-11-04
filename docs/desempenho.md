# Desempenho do cliente e orçamento de assets (Fase 6)

Parte da Fase 6 ("Testes de desempenho", "Otimização de modelos/texturas/VFX" — seção 15 do [plano](plano_mvp_rpg_tatico.md)). O servidor (latência de comando, salas em paralelo, custo de escrita no banco) está em [fase-06.md](fase-06.md).

## Como rodar

```bash
npm run web                      # cliente em http://127.0.0.1:5173 (precisa estar rodando)
npm run perf:client              # 3 partidas completas no SwiftShader (padrão do e2e)
npm run perf:client -- --gpu     # as mesmas, na GPU (ANGLE D3D11)
npm run perf:client -- --both    # as duas (≈ 15 min)
npm run perf:client -- --runs=stress --max=40   # só a de estresse, até 40 comandos
npm run perf:assets              # auditoria dos GLBs, texturas e partículas × orçamento (--strict sai com 1 se passar)
```

`tools/perf/client.ts` abre o cliente num Chrome headless (1400 × 900, escala 1) e joga **partidas locais completas**: os dois lados são decididos no Node por um `BotBrain` difícil, cada um só com a visão da própria equipe, e o comando entra por `__arena.match.execute` — o mesmo caminho dos cliques, com animações, VFX e sons normais. Dentro da página um coletor (injetado; o cliente não foi alterado) registra a cada quadro: intervalo entre quadros (FPS real), tempo de CPU do `scene.render()` (das animações ao fim do desenho, inclui o mapa de sombras), draw calls (contador do próprio engine, `engine._drawCalls`), índices ativos (÷ 3 = triângulos), malhas ativas e partículas vivas. A cada 10 comandos registra malhas/materiais/texturas/sistemas de partículas da cena e o heap JS **depois de um GC forçado** pelo CDP (vazamento). Resultado: tabelas no console + JSON em `.data/perf/client-<data>.json`.

| Execução | O que é |
|---|---|
| `duel` | 1 × 1 Mago × Druida, semente 4242 |
| `stress` | 1 × 1 Mago × Mago posicionados junto aos barris; no 1º turno de cada lado, Chama concentrada no barril → **2 explosões**, óleo em chamas (6 células), depois os bots seguem até o fim |
| `2v2` | 2 × 2 Guerreiro + Ladino × Mago + Druida, semente 9001 (4 personagens, mais VFX) |

"Pesado" = só os quadros dos comandos com explosão ou com ≥ 2 células/objetos em chamas.

## Ambiente e ressalvas

- Windows 11, Intel i5-14400 (16 threads), 17 GB, **NVIDIA GeForce RTX 3050**, Chrome headless (`--headless=new`), cliente servido pelo Vite em modo dev (sem minificação).
- **SwiftShader** (`--use-angle=swiftshader`, o que todos os e2e usam) é rasterização **por software na CPU**: os números mostram o pior caso possível (máquina sem GPU / GPU bloqueada), não o de um jogador. O `scene.render()` gasta pouco na CPU do JS (~5 ms parado); o resto do quadro é o SwiftShader rasterizando.
- **GPU** (`--gpu` → `--use-angle=d3d11 --enable-gpu`): renderizador confirmado `ANGLE (NVIDIA GeForce RTX 3050 Direct3D11)`. No headless o Chrome não tem vsync de monitor e entrega quadros a ~55 por segundo (intervalo de ~18 ms **mesmo com a cena parada e 3–4 ms de CPU de render**): o teto de ~55 fps é do agendador do headless, não do jogo. Numa janela normal o esperado é o limite do monitor (60 Hz+).
- As medições rodaram com outros processos pesados na máquina (simulações em lote de balanceamento e testes do servidor em paralelo), então há algum ruído de CPU — mais visível no SwiftShader.
- Os dados da partida são aleatórios mas com semente fixa: as duas renderizações jogaram exatamente as mesmas partidas (mesmos comandos, rodadas e vencedor), o que torna as colunas comparáveis.

## Resultados (03/11/2026, `npm run perf:client -- --both`)

Meta adotada (o plano não fixa números; item 10 da seção da câmera pede "desempenho aceitável com transparência e efeitos"): **≥ 60 fps com GPU dedicada/integrada comum e quadro p95 ≤ 33 ms (30 fps) como piso**.

### Quadros

| Execução | Render | Trecho | Quadros | FPS méd. | FPS p5 | Quadro méd./p95 (ms) | CPU render méd./p95 (ms) | Draw calls méd./máx. | Triângulos ativos méd./máx. | Partículas máx. |
|---|---|---|---|---|---|---|---|---|---|---|
| duelo 1×1 | **GPU** | parado | 172 | 55,6 | 53,2 | 18,0 / 18,8 | 3,4 / 4,0 | 229 / 229 | 46 153 / 46 153 | 0 |
| duelo 1×1 | **GPU** | partida | 4 467 | 51,6 | 51,8 | 19,4 / 19,3 | 5,6 / 5,2 | 232 / 286 | 47 719 / 59 081 | 77 |
| estresse | **GPU** | partida | 3 176 | 53,3 | 52,1 | 18,8 / 19,2 | 5,6 / 5,9 | 274 / 315 | 51 300 / 59 239 | 204 |
| estresse | **GPU** | pesado | 1 601 | 52,2 | 51,5 | 19,2 / 19,4 | 6,1 / 6,2 | 270 / 307 | 50 331 / 59 239 | 204 |
| 2×2 | **GPU** | parado | 175 | 55,7 | 53,2 | 18,0 / 18,8 | 4,1 / 4,8 | 288 / 288 | 63 111 / 63 111 | 0 |
| 2×2 | **GPU** | partida | 7 978 | 53,8 | 52,1 | 18,6 / 19,2 | 5,5 / 6,4 | 291 / 382 | 64 004 / 93 481 | 174 |
| 2×2 | **GPU** | pesado | 2 142 | 54,4 | 52,1 | 18,4 / 19,2 | 5,3 / 6,0 | 275 / 332 | 57 962 / 73 913 | 174 |
| duelo 1×1 | SwiftShader | parado | 37 | 11,6 | 10,5 | 86,1 / 95,5 | 4,8 / 5,8 | 229 / 229 | 46 153 / 46 153 | 0 |
| duelo 1×1 | SwiftShader | partida | 1 119 | 9,6 | 4,3 | 103,7 / 230,4 | 16,9 / 130,5 | 233 / 291 | 47 176 / 59 141 | 78 |
| estresse | SwiftShader | partida | 732 | 9,4 | 4,2 | 106,8 / 236,3 | 18,0 / 113,4 | 273 / 315 | 51 076 / 59 299 | 206 |
| estresse | SwiftShader | pesado | 375 | 9,1 | 3,3 | 109,5 / 305,4 | 23,5 / 203,2 | 269 / 306 | 50 040 / 59 299 | 206 |
| 2×2 | SwiftShader | parado | 36 | 11,3 | 10,9 | 88,3 / 91,5 | 5,9 / 7,0 | 288 / 288 | 63 111 / 63 111 | 0 |
| 2×2 | SwiftShader | partida | 1 854 | 9,0 | 5,7 | 110,7 / 174,5 | 13,0 / 14,4 | 293 / 382 | 63 765 / 93 481 | 176 |

(O duelo não teve explosão nem fogo — os bots não usaram o ambiente nessa semente —, por isso não tem linha "pesado".)

### Cena e memória ao longo da partida

| Execução | Comandos | Rodadas | Carga até "pronto" (GPU / SwiftShader) | Heap JS início → fim (MB, após GC) | Malhas início → fim | Materiais | Texturas (mem. estimada) | Sistemas de partículas (pool) |
|---|---|---|---|---|---|---|---|---|
| duelo 1×1 | 75 | 11 | 4,6 s / 6,6 s | 31 → 38 | 149 → 149 | 73 → 111 | 47 → 50 (99 MB) | 0 → 11 |
| estresse | 35 | 6 | 3,7 s / 5,9 s | 30 → 38 | 149 → 165 | 73 → 107 | 47 → 51 (72 MB) | 0 → 26 |
| 2×2 | 107 | 9 | 5,9 s / 8,4 s | 33 → 42 | 188 → 196 | 106 → 164 | 80 → 84 (173 MB) | 0 → 20 |

Nenhum erro ou aviso no console em nenhuma das seis execuções.

### Leitura

- **Com GPU o cliente está folgado:** 3–6 ms de CPU por quadro (p95 ≤ 6,4 ms mesmo com 2 explosões, fogo em 6 células e 4 personagens), FPS travado no teto do headless; o p5 fica a 1–3 fps da média (sem engasgos). Atende à meta com margem de ~3× no tempo de quadro.
- **No SwiftShader** (sem GPU) o jogo fica em ~9–11 fps, com quedas a 3–4 fps nos picos (projéteis + explosão + partículas). É jogável só como depuração/automação — que é o uso dele aqui (e2e). Não é alvo de suporte.
- **Draw calls (~230 no 1 × 1, ~290 no 2 × 2, máx. 382)** são o maior custo fixo: cerca de metade é o passe do mapa de sombras (117 lançadores de sombra) e cada personagem desenha 16–22 partes (um material/textura por parte, herança do gerador de IA) — duas vezes, com a sombra. Dentro do confortável para WebGL2 em desktop; seria o primeiro alvo num notebook fraco (ver "Próximos passos").
- **Triângulos ativos:** 46–63 mil parado, pico de 93 mil (2 × 2 com muitos efeitos). Irrelevante para qualquer GPU atual.
- **Partículas:** pico de **206 partículas vivas** e **26 sistemas** no pool (estresse). Os presets são limitados (`capacity` 16–90 por sistema) e as rajadas são cortadas na capacidade (`burst` usa `min(count, capacity)`).
- **Vazamento:** **não há crescimento de malhas** (149 → 149 no duelo; no estresse/2 × 2 as malhas a mais são as superfícies persistentes — fogo, espinhos — e os pedaços de barril/caixote que continuam no estado). Os **materiais** que aparecem ao longo da partida (+38 no duelo) foram conferidos pelo nome (o relatório imprime "materiais novos ao fim"): são **caches criados no primeiro uso** de cada efeito (`mat:vfx:<efeito>`, `mat:fx:shield`, `mat:fx:roots`, um material sem luz por cor de VFX) e dos GLBs de VFX carregados sob demanda — um por efeito/cor, limitados pelo catálogo, não por comando. O heap sobe ~7–9 MB pelo mesmo motivo (contêineres de VFX, pool de partículas, histórico de eventos da partida) e desacelera no fim da partida (2 × 2: 40,2 MB no comando 50 → 42,3 MB no 107). Recomeçar ("Jogar novamente") recarrega a página e zera tudo.
- **Texturas:** a maior é o mapa de sombras (2048²); as dos personagens têm até 1024² (WebP no arquivo, descomprimidas na GPU). Memória estimada (largura × altura × 4, sem mipmaps): 72–99 MB no 1 × 1, 173 MB no 2 × 2 — ~85 % são as texturas dos personagens (16–22 por modelo). Aceitável em desktop; é o segundo argumento para o atlas de textura.

## Orçamento de assets (`npm run perf:assets`)

Orçamentos de [fase-02-modelos-3d.md](fase-02-modelos-3d.md) (hipóteses do plano): personagem ~5 000 triângulos, objeto ~1 500, peça de construção ~500, texturas ≤ 1024 px. Os efeitos não têm orçamento no plano; usa-se o de objeto. Objetos de cenário (portas, barris, caixotes, baús, cisterna, alavanca, altar) e terreno são **procedurais** (`MeshBuilder`), sem GLB — dezenas de triângulos cada.

| Arquivo | Tipo | KB | Triângulos | Orçamento | Texturas | Situação |
|---|---|---|---|---|---|---|
| characters/druid.glb | personagem | 555 | 4 296 (era 6 086) | 5 000 | 22 (até 1024²) | ✅ (Fase 6) |
| characters/mage.glb | personagem | 369 | 4 119 (era 6 303) | 5 000 | 22 (até 1024²) | ✅ (Fase 6) |
| characters/rogue.glb | personagem | 427 | 4 293 (era 6 269) | 5 000 | 17 (até 1024²) | ✅ (Fase 6) |
| characters/warrior.glb | personagem | 391 | 4 132 (era 6 272) | 5 000 | 16 (até 1024²) | ✅ (Fase 6) |
| environment/ornate_circular_base_plate.glb | objeto | 70 | 4 800 | 1 500 | — | ⚠️ acima (aceito, ver decisões) |
| vfx/heal.nature, item.focus, item.health | efeito | 43 cada | 1 584 | 1 500 | — | ⚠️ +6 % (aceito) |
| demais 19 GLBs de vfx | efeito | 6–37 | 64–1 440 | 1 500 | — | ✅ |

Total baixado em modelos: **2,3 MB** em 27 arquivos (era 2,38 MB); ícones da interface 0,38 MB (42 arquivos). Nenhuma textura passa de 1024 px.

Partículas (presets em `apps/web/src/rendering/fx/particles.ts`, capacidade = partículas vivas por sistema): flame 42 · flameSmall 22 · sparks 90 · smoke 30 · rise 40 · frost 18 · trail 40 · dust 30 · shimmer 16. Medido: pico de 206 partículas / 26 sistemas numa cena com 2 explosões e 6 células em chamas.

## Otimizações feitas

1. **Personagens dentro do orçamento:** a meta de triângulos de `tools/models/optimize.ts` para os personagens baixou de 8 000 para **5 000** e as quatro versões do jogo foram regeneradas a partir dos originais (`npm run optimize-models -- characters`; originais em `assets/models/source/` intactos). Resultado: 6,1–6,3 mil → **4,1–4,3 mil triângulos** (−32 %), arquivos −4 a −5 % (as texturas dominam o tamanho). `assets/models/characters/manifest.json` (bytes, sha256, triângulos, vértices), `assets/models/optimization-report.json` e [modelos-classes.md](modelos-classes.md) atualizados. Conferência visual na distância mínima da câmera (10 m), mesma cena antes/depois: [antes](screenshots/fase-06/modelos-antes-perto.png) · [depois](screenshots/fase-06/modelos-depois-perto.png) — sem diferença perceptível.
2. **Ferramentas de medição** (`perf:client`, `perf:assets`) e a opção `gpu` em `tools/e2e/cdp.mjs` (`launch({ gpu: true })`; o padrão continua SwiftShader para os e2e).

Nada foi mudado no código de renderização: com GPU os números estão bem dentro da meta e os limites de partículas já existentes seguram os picos.

## Decisões (tomadas sem consulta)

1. **Meta de desempenho** (o plano não fixa números): 60 fps em GPU comum, piso de 30 fps (quadro p95 ≤ 33 ms). SwiftShader não é alvo (só automação).
2. **Placa ornamentada (4 800 triângulos) mantida** acima do orçamento de objeto: são 2 instâncias (altares de Foco), ~10 mil triângulos no total, custo desprezível; baixar para 1 500 apaga os ornamentos (ver [modelos-cenario.md](modelos-cenario.md)).
3. **VFX de cura/poções (1 584 triângulos, +6 %) mantidos:** vêm das fontes em `tools/vfx` (fora do escopo desta fase) e aparecem só por instantes.
4. **Sem atlas/junção de malhas dos personagens:** reduziria draw calls (~22 → 1–2 por personagem) e memória de textura, mas exige refazer UVs/texturas (trabalho de arte). Não é necessário para a meta com GPU.

## Lacunas e próximos passos

- Medido numa só máquina (RTX 3050) e no SwiftShader; falta um notebook com GPU integrada (Intel/AMD) — é onde os ~300 draw calls e ~170 MB de texturas do 2 × 2 podem pesar. `npm run perf:client -- --gpu` serve para essa medição.
- O FPS com GPU no headless fica preso em ~55 pelo agendador do Chrome; o número útil é o **tempo de CPU de render** (3–6 ms). Uma medição em janela normal (com vsync) não foi automatizada.
- Se for preciso economizar: (1) atlas + junção das partes de cada personagem; (2) mapa de sombras 2048 → 1024 ou menos lançadores (pisos/paredes que não precisam projetar); (3) congelar matrizes do terreno estático (`freezeWorldMatrix`) e materiais (`freeze`).
- Cliente medido em modo dev do Vite (sem minificação); o build de produção (`vite build`) não muda o custo de GPU, só o tempo de carga.
