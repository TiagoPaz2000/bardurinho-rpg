# Modelos de cenário

Modelos de ambiente importados para o cliente 3D (Fase 2). As regras gerais (escala, pivô, orientação, orçamento de polígonos) estão em [fase-02-modelos-3d.md](fase-02-modelos-3d.md). Os metadados de cada modelo ficam em `assets/models/environment/manifest.json`.

## `ornate_circular_base_plate` — Placa de base circular ornamentada

O jogo carrega a versão **otimizada** em `assets/models/environment/ornate_circular_base_plate.glb`. O original de alta resolução fica em `assets/models/source/environment/ornate_circular_base_plate.glb` e não é alterado.

### Versão otimizada (usada no jogo)

| Item | Valor |
|---|---|
| Arquivo | `assets/models/environment/ornate_circular_base_plate.glb` |
| Gerado por | `npm run optimize-models -- plate` (`tools/models/optimize.ts`) |
| Tamanho | 71,6 KB (era 48,1 MB) |
| Triângulos / vértices | 4.800 / 8.806 (era 1.948.544 / 1.031.465) |
| Atributos | `POSITION`, `NORMAL` (normais recalculadas) |
| Extensões exigidas | `EXT_meshopt_compression`, `KHR_mesh_quantization` |
| Limites | min (−1,960; 0,000; −1,958), max (1,957; 0,648; 1,957) — até ~4 mm menores que o original; base continua em y = 0 |
| SHA-256 | `6321386ddee0ce90a9d24698646775fb57f0bc92f2e05bea42025b08539ce624` |

**Como foi feito.** O `simplify` do glTF-Transform CLI parava em ~88 mil triângulos, qualquer que fosse a tolerância de erro. A causa são as normais do original: vértices na mesma posição com normais diferentes formam costuras que o meshoptimizer não colapsa. O job da placa usa então `geometryOnly` no script:

1. descarta `NORMAL` e solda os vértices só por posição (1.031.465 → 974.272 vértices; a malha fica contínua);
2. simplifica com `MeshoptSimplifier.simplify` (flag `Prune`, que remove pedaços soltos abaixo do erro) até 4.800 triângulos; o erro resultante é ~0,46% do tamanho da malha (~2 cm);
3. recalcula as normais: suaves, ponderadas por área, mas com quina acima de 50° (degraus e bordas ficam com aresta viva);
4. roda o `optimize` do CLI com `--simplify false` (compressão meshopt e quantização).

`simplifySloppy` também foi testado e chega à meta, mas destrói o perfil em degraus e os ornamentos; a simplificação normal preserva o contorno redondo, os degraus e o desenho do relevo (em forma mais grosseira). Para conferir a forma: `npx tsx tools/models/preview.ts <arquivo.glb> <saida.png>` desenha vistas lateral, de cima e 3/4.

No Babylon.js o arquivo precisa do decodificador meshopt (`MeshoptCompression`), que por padrão vem de CDN; para uso offline, configure `MeshoptCompression.Configuration` apontando para uma cópia local.

### Original (referência de alta resolução)

| Item | Valor |
|---|---|
| Arquivo | `assets/models/source/environment/ornate_circular_base_plate.glb` |
| Origem | `Ornate French circular base plate.glb` (gerado pelo Tripo, glTF 2.0); cópia byte a byte, sem alterações |
| SHA-256 | `f01c41b264e32a3381e8c07087a8a5f2a75b88b6ff676745ffb0c6e9ffb44091` |
| Tamanho | 48,1 MB (45,9 MiB) |
| Estrutura | 1 cena, 1 nó, 1 malha, 1 primitiva (triângulos, índices `uint32`) |
| Triângulos / vértices | 1.948.544 / 1.031.465 |
| Atributos | `POSITION`, `NORMAL` (sem UV, sem cor de vértice) |
| Materiais / texturas | Nenhum / nenhuma |
| Esqueleto / animações | Nenhum / nenhuma |

### Dimensões (metros)

| Medida | Valor |
|---|---|
| Diâmetro (X e Z) | 3,92 m |
| Altura total | 0,65 m |
| Perfil | Degraus que sobem da borda (r ≈ 1,96 m) até um platô em ≈ 0,45–0,50 m; ressalto central (r ≈ 0,43 m) até 0,65 m |
| Limites | min (−1,961; 0; −1,961), max (1,961; 0,650; 1,961) |
| Eixo vertical | +Y (altura 0,65 m contra 3,92 m de diâmetro; base exatamente em y = 0) |
| Pivô | Centro da base: y mínimo = 0, X/Z simétricos; o nó tem translação de ~0,0001 m (desprezível) |
| Orientação | Simetria radial; a frente (+Z) não importa |

Os limites foram conferidos lendo todos os vértices, não só o `min`/`max` do accessor.

### Encaixe no grid de 2 m

- **Escala original (1,0):** 3,92 m de diâmetro cabem num bloco de **2 × 2 células** (4 × 4 m), com 4 cm de folga em cada lado.
- **Escala 0,5:** 1,96 m × 0,325 m, cabe em **1 célula** (2 × 2 m).
- A altura de 0,65 m não corresponde a um nível do mapa: as regras só conhecem térreo e plataformas a 4 m. Se a placa ficar sob células caminháveis, ela é apenas visual (a unidade "flutua" ou atravessa o relevo). Por isso é melhor usá-la sob algo que já bloqueia a célula, ou na escala reduzida.

### Problemas e correções

| Problema | Correção recomendada |
|---|---|
| ~1,95 milhão de triângulos, cerca de 1.300 vezes o orçamento de objetos (~1,5 mil) | **Feito:** derivado de 4.800 triângulos (71,6 KB) em `assets/models/environment/`; o original de 48 MB ficou em `assets/models/source/environment/` como referência. Ainda acima do orçamento de ~1,5 mil; se precisar, baixar `maxTriangles` do job em `tools/models/optimize.ts` (os ornamentos vão sumindo). |
| Sem material | Atribuir no loader um material PBR de pedra (cor, rugosidade); serve também para o brilho "ativo / usado" do altar |
| Sem UV | Texturas exigem desembrulhar UV no derivado; até lá, só material de cor sólida |
| Escala (2 × 2 células) | Aplicar no loader, no nó raiz (`scaling = 0,5` para 1 célula). Não editar o GLB |
| Pivô | Já está correto (centro da base, y = 0); nenhum ajuste necessário |
| Nome do arquivo ≠ id do catálogo | A especificação pede nome igual ao id. Se virar base do altar, o vínculo pode ficar no manifesto ou o derivado pode se chamar pelo id |

Recomendação geral: **normalizar no loader** (escala, material, eventual deslocamento) em vez de editar o arquivo. A redução de polígonos já é um asset derivado separado, gerado pelo script.

### Usos sugeridos

A decisão fica com o time; abaixo, as opções com melhor encaixe.

1. **Base do Altar de Foco (`focus_altar`), escala 0,5.** O altar é um objeto de 1 célula, de pedra (`STONE`), que bloqueia o movimento — a placa reduzida ocupa exatamente essa célula, sem conflito com a regra de caminho. O formato de pedestal ornamentado combina com um altar; o ressalto central serve de apoio para a peça do altar (cristal, chama, etc.). No mapa atual há dois altares (`altar-01` em (1,1) e `altar-02` em (14,14)).
2. **Plataforma decorativa central / marco visual, escala 1,0.** Cobre um bloco de 2 × 2 células, útil como ponto de referência ou marcador de área de início. Como os 0,65 m de altura não existem nas regras, deve ficar em células não caminháveis ou ser rebaixada (parcialmente enterrada, ex.: y = −0,45 m, deixando só o ressalto central à mostra).
