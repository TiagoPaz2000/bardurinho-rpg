# Modelos 3D das classes

Quatro modelos `.glb` foram importados. Os originais ficam em `assets/models/source/characters/<classe>.glb`, sem alterações (cópias byte a byte, SHA-256 conferido). O jogo carrega as versões otimizadas em `assets/models/characters/<classe>.glb` (ver [Otimização](#otimização)). Os metadados ficam em [`assets/models/characters/manifest.json`](../assets/models/characters/manifest.json).

Todos foram gerados pelo **Tripo 2.0** (campo `asset.generator` do glTF).

## Mapeamento classe → modelo

| Classe | Arquivo | Original | Motivo |
|---|---|---|---|
| Mago (`mage`) | `mage.glb` | `wizard owl 3d model.glb` | Nome do modelo ("wizard") |
| Guerreiro (`warrior`) | `warrior.glb` | `dog knight 3d model.glb` | Nome do modelo ("knight") |
| Ladino (`rogue`) | `rogue.glb` | `fantasy cat 3d model.glb` | **Escolha.** Texturas de couro escuro costurado, bordô e dourado, com capa. Combina com "armadura de couro" do Ladino |
| Druida (`druid`) | `druid.glb` | `forest ranger mouse 3d model.glb` | **Escolha.** Capa e capuz verdes, texturas com folhas e casca de madeira. Combina com "elementos de folha ou galho" do Druida |

> **Ladino e Druida podem ser trocados.** O nome "ranger" do rato lembra arqueiro, o que puxaria para o Ladino. Mas nenhum dos dois modelos tem arco, adaga ou cajado identificável: a maior peça fina tem cerca de 0,35 m. Por isso a escolha seguiu as texturas. Para trocar, basta inverter os dois arquivos e as entradas no manifesto.

## Dados de cada modelo (originais)

Valores dos originais em `assets/models/source/characters/`; os das versões otimizadas estão em [Otimização](#otimização). Os valores vêm da leitura do contêiner GLB (JSON + BIN). Os limites consideram as translações dos nós (não há rotação nem escala nos nós).

| Classe | Tamanho | Triângulos | Vértices | Malhas / materiais / texturas | Esqueleto | Animações | Altura (Y) | Base X × Z |
|---|---:|---:|---:|---|---|---|---:|---|
| mage | 3,65 MB | 48.760 | 29.132 | 22 / 22 / 22 | não | 0 | 0,98 m | 0,75 × 0,63 m |
| rogue | 3,85 MB | 47.910 | 28.250 | 17 / 17 / 17 | não | 0 | 0,98 m | 0,69 × 0,59 m |
| warrior | 3,89 MB | 49.682 | 29.186 | 16 / 16 / 16 | não | 0 | 0,98 m | 0,78 × 0,56 m |
| druid | 3,87 MB | 47.816 | 29.032 | 22 / 22 / 22 | não | 0 | 0,98 m | 0,86 × 0,63 m |

**Total: cerca de 15 MB.**

Características comuns aos quatro:

- **Estrutura:** um nó `ParentNode` sem transformação, com 16 a 22 filhos `tripo_part_N`. Cada filho tem uma malha e um material próprios.
- **Atributos de vértice:** apenas `POSITION`, `NORMAL` e `TEXCOORD_0`. Não há `JOINTS_0`/`WEIGHTS_0` nem *morph targets*.
- **Materiais:** PBR com `metallic = 0` e `roughness = 0,9`, duas faces (`doubleSided`). Só há textura de cor base. Não há mapas de normal, rugosidade ou emissão.
- **Texturas:** JPEGs embutidos de 64 a 2048 px. Cada modelo tem de 2 a 3 texturas de 2048². As imagens ocupam cerca de 66–68% do arquivo.
- **Eixos:** Y para cima. A menor coordenada Y é 0, ou seja, o pivô está no chão. X e Z estão centrados em torno de 0.
- **Frente:** provavelmente +Z. Pés e detalhes do rosto ficam do lado +Z; a cauda do gato e a do rato ficam em −Z. Isso é uma estimativa geométrica e precisa ser confirmada visualmente no cliente.
- **Proporção chibi:** a peça da cabeça vai de cerca de 0,44 m a 0,98 m, ou seja, ocupa metade da altura.

## Otimização

`npm run optimize-models` (`tools/models/optimize.ts`) gera as versões do jogo a partir dos originais com o `optimize` do glTF-Transform: solda vértices, simplifica com meshoptimizer (proporção e erro ajustados até ficar abaixo de 5 mil triângulos — era 8 mil até a Fase 6), comprime a geometria com **meshopt** (`EXT_meshopt_compression` + `KHR_mesh_quantization`) e converte as texturas para **WebP** (`EXT_texture_webp`) com no máximo 1024 px. O relatório de cada execução fica em `assets/models/optimization-report.json`.

| Classe | Tamanho | Triângulos | Vértices | Malhas / materiais / texturas |
|---|---:|---:|---:|---|
| mage | 0,38 MB (era 3,65) | 4.119 (era 48.760; 6.303 antes da Fase 6) | 3.736 | 22 / 22 / 22 |
| rogue | 0,44 MB (era 3,85) | 4.293 (era 47.910; 6.269) | 3.617 | 17 / 17 / 17 |
| warrior | 0,40 MB (era 3,89) | 4.132 (era 49.682; 6.272) | 3.492 | 16 / 16 / 16 |
| druid | 0,57 MB (era 3,87) | 4.296 (era 47.816; 6.086) | 3.910 | 22 / 22 / 22 |

**Total: cerca de 1,8 MB** (eram ~15 MB). Comparação visual antes/depois da redução da Fase 6: [antes](screenshots/fase-06/modelos-antes-perto.png) · [depois](screenshots/fase-06/modelos-depois-perto.png) (ver [desempenho.md](desempenho.md)).

- **Babylon.js precisa do decodificador meshopt.** Por padrão o loader baixa o decodificador de uma CDN; para funcionar offline, configure `MeshoptCompression.Configuration` com uma cópia local (o pacote `meshoptimizer` traz o `meshopt_decoder`). WebP é suportado nativamente pelos navegadores.
- **Materiais não foram fundidos:** continuam 16–22 materiais/texturas por personagem (~80 *draw calls* com os quatro em cena). Próximo passo: gerar um atlas de textura por personagem e juntar as malhas em uma só.

## Lacunas em relação a [fase-02-modelos-3d.md](fase-02-modelos-3d.md)

| Requisito da Fase 2 | Situação | O que fazer |
|---|---|---|
| Formato `.glb` | OK | — |
| Pivô no centro da base (y = 0) | OK | — |
| Frente para +Z | Provável | Confirmar no cliente; se estiver errado, girar no carregador |
| Escala: 1 unidade = 1 m; personagem com 1,5–1,9 m para caber em célula de 2 m | **Falta**: 0,98 m | Aplicar escala de ~1,7 no carregador. Isso dá ~1,67 m de altura e base de até ~1,46 m, que cabe na célula. O fator está em `recommendedScale` no manifesto |
| Corpo humanoide base único para as 4 classes | **Falta** | São quatro corpos diferentes (coruja, gato, cachorro, rato) |
| Esqueleto compartilhado (P1) | **Falta** | Nenhum modelo tem esqueleto |
| 9 animações P1 (`idle`, `walk`, `melee`, `shoot`, `cast_forward`, `cast_self`, `hit`, `death`, `interact`) | **Falta**: 0 animações | Fazer rig e animar |
| Armas presas à mão do esqueleto | **Falta** | Não há ossos de mão. Os modelos também não têm arma separável identificada |
| Cor parametrizável por equipe (P1) | **Falta** | Só há textura de cor, sem máscara. Alternativas: tingir uma peça específica (ex.: capa), ou usar anel/contorno no chão ou *outline* por equipe |
| Orçamento de ~5 mil triângulos | **OK** (Fase 6): 4,1–4,3 mil nas versões otimizadas (originais: 48–50 mil) | — |
| Atlas de textura compartilhado | **Falta**: 16–22 materiais por modelo | Juntar as malhas e as texturas em um atlas. Isso reduz *draw calls* de ~80 para ~4 com os quatro em cena |

## Próximos passos recomendados

1. **Usar agora como placeholder estático.** No carregador do Babylon, aplicar escala de 1,7, manter o pivô e confirmar a frente. Os arquivos não devem ser editados para isso. Na falta de animações, dá para simular movimento por código: deslizar entre células, pequeno salto, piscar vermelho ao receber dano, tombar ao ser derrotado.
2. **Otimizar.** Decimação para ~4–5 mil triângulos, meshopt e WebP já feitos (ver [Otimização](#otimização)). Falta juntar as partes e gerar um atlas de 1024–2048 px.
3. **Fazer rig e animar.** Como os corpos têm proporções diferentes, um único esqueleto compartilhado exige retarget. Opções: um rig humanoide comum com proporções chibi aplicado aos quatro (ex.: auto-rig + retarget no Blender), ou relaxar o requisito para "mesmos nomes de ossos e mesmos clipes", com retarget por classe.
4. **Armas.** Modelar as armas à parte (`weapon.*`) e prender a um osso de mão depois do rig.
5. **Cor de equipe.** Separar uma peça (capa, faixa) com material próprio para tingir, ou usar um indicador no chão.

## Observações sobre o repositório

- O `.gitignore` não exclui `assets/models/`: `git check-ignore` não acusou nada para esses arquivos.
- Os quatro originais somam ~15 MB de binários (as versões otimizadas, ~1,9 MB). Se houver novas versões (otimizadas, com rig), vale considerar o **Git LFS** para `*.glb`.
