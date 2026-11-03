# Fase 2 — Lista de modelos 3D

Baseada nas seções 6 (mapa), 7.1 (modelos), 7.2 (animações) e 15 (Fase 2) do [plano do MVP](plano_mvp_rpg_tatico.md).

A Fase 2 pede **personagens provisórios** e o **primeiro mapa 3D**. Por isso, muitos itens podem começar como blocos simples (*placeholder*) e ser trocados depois, sem mudar código: cada modelo é referenciado pelo id do catálogo.

**Legenda de prioridade**

| Prioridade | Significado |
|---|---|
| **P1** | Necessário para o critério da Fase 2: uma partida completa no cliente 3D |
| **P2** | Necessário na Fase 2; pode ser placeholder simples |
| **P3** | Previsto no plano; pode ficar para a Fase 4 (conteúdo completo) |

## Especificações gerais

| Item | Definição |
|---|---|
| Formato | glTF binário (`.glb`), carregado pelo Babylon.js |
| Escala | 1 unidade = 1 metro |
| Célula do grid | 2 × 2 m |
| Altura das plataformas | 4 m acima do térreo |
| Pivô | Centro da base, no chão (y = 0) |
| Orientação | Frente voltada para +Z |
| Nome do arquivo | Igual ao id do catálogo (ex.: `door.glb`, `barrel.glb`) |
| Peças de construção | Modulares, encaixando na grade de 2 m |
| Texturas | Atlas compartilhado quando possível; PBR simples (cor, normal, rugosidade) |
| Orçamento de polígonos | Hipótese a validar: personagem até ~5 mil triângulos; objetos até ~1,5 mil; peças de construção até ~500 |

## 1. Personagens

| Modelo | Prioridade | Observações |
|---|---|---|
| Corpo humanoide base | **P1** | Um único corpo, compartilhado pelas 4 classes |
| Esqueleto compartilhado | **P1** | Todas as animações usam o mesmo esqueleto |
| Conjunto visual — Mago | **P2** | Túnica; na versão provisória, basta cor + chapéu |
| Conjunto visual — Ladino | **P2** | Armadura de couro, capuz |
| Conjunto visual — Guerreiro | **P2** | Cota reforçada, elmo |
| Conjunto visual — Druida | **P2** | Armadura de couro, elementos de folha ou galho |
| Variação de cor por equipe | **P1** | Material com cor parametrizável (equipe A / B), sem modelo extra |
| Boneco de teste | P3 | Só se o Debug Lab também ganhar visão 3D; um manequim simples basta |

### Animações (esqueleto compartilhado, seção 7.2)

| Animação | Prioridade | Uso |
|---|---|---|
| `idle` | **P1** | Parado |
| `walk` | **P1** | Deslocamento célula a célula |
| `run` | P3 | Deslocamentos longos |
| `melee` | **P1** | Espada, adaga, Empurrão |
| `shoot` | **P1** | Arco, Tiro preciso |
| `cast_forward` | **P1** | Varinha, cajado, Chama, Geada, Espinheiro, Enraizar |
| `cast_self` | **P1** | Barreira arcana, Cura natural, poções |
| `hit` | **P1** | Receber dano |
| `death` | **P1** | Derrota |
| `interact` | **P1** | Porta, alavanca, baú, cisterna, altar |

## 2. Armas (presas à mão do esqueleto)

| Modelo | Id | Prioridade |
|---|---|---|
| Espada de ferro | `weapon.iron_sword` | **P2** |
| Adaga | `weapon.dagger` | **P2** |
| Arco curto | `weapon.short_bow` | **P2** |
| Varinha arcana | `weapon.arcane_wand` | **P2** |
| Cajado natural | `weapon.nature_staff` | **P2** |
| Flecha (projétil) | — | **P2** — usada no rastro do arco e do Tiro preciso |

## 3. Construção do mapa (peças modulares)

| Peça | Prioridade | Observações |
|---|---|---|
| Piso (2 × 2 m) | **P1** | Térreo e plataformas |
| Parede reta (2 m) | **P1** | |
| Canto de parede | **P1** | |
| Pilar | **P2** | Também sustenta as plataformas |
| Escada | **P1** | Liga o térreo à plataforma (4 m); atravessar custa 2 PM |
| Plataforma elevada | **P1** | Área de aproximadamente 6 × 2 células; pode ser montada com pisos + pilares |
| Guarda-corpo | **P1** | Borda das plataformas; impede leitura de "queda" (o Empurrão não derruba no MVP) |
| Batente / vão de porta | **P2** | Encaixe da porta na parede |
| Alcova de área escura | P3 | Pode ser só parede + iluminação; não exige modelo próprio |

## 4. Objetos interativos

| Modelo | Id | Qtd. no mapa | Estados visuais | Prioridade |
|---|---|---:|---|---|
| Porta de madeira | `door` | 2 | Fechada, aberta (animação), destruída | **P1** |
| Barril explosivo | `barrel` | 4 | Normal, restos após explosão | **P1** |
| Caixa / barricada | `crate` | 4 | Normal, quebrada | **P1** |
| Portão central | `gate` | 1 | Fechado, aberto (animação) | **P2** |
| Alavanca do portão | `lever` | 1 | Duas posições (animação) | **P2** |
| Baú de suprimentos | `chest` | 2 | Fechado, aberto (animação) | **P2** |
| Cisterna | `cistern` | 2 | Cheia, vazia | **P2** |
| Altar de Foco | `focus_altar` | 2 | Ativo (brilho), usado | **P2** |
| Tocha | — | várias | Acesa | P3 — apenas decoração e iluminação |

### Estados destruídos (seção 7.1)

| Modelo | Prioridade |
|---|---|
| Porta quebrada | **P1** |
| Caixa quebrada | **P1** |
| Restos de barril | **P1** |

## 5. Consumíveis

| Modelo | Id | Prioridade |
|---|---|---|
| Frasco base | — | P3 |
| Variação: poção de vida | `consumable.health_potion` | P3 |
| Variação: poção de Foco | `consumable.focus_potion` | P3 |
| Variação: frasco de óleo | `consumable.oil_flask` | **P2** — é arremessado; aparece como projétil |

Um único frasco com três materiais atende os três consumíveis.

## 6. O que **não** precisa de modelo 3D

Estes itens são **efeitos visuais, decalques ou materiais** (seção 7.4), não modelos:

| Elemento | Solução visual |
|---|---|
| Óleo no chão | Decalque ou material sobre o piso |
| Fogo no chão / objeto / personagem queimando | Partículas |
| Espinhos | Decalque + pequenos espinhos instanciados, ou partículas |
| Água da cisterna | Partículas / onda |
| Explosão, impacto, projéteis elementais | Partículas |
| Barreira, ocultação, cura, raízes | Shader ou partículas sobre o personagem |
| Destaque de alcance, área e caminho | Malha plana gerada em código sobre o grid |
| Grid lógico | Invisível; não é um modelo |

## Resumo da Fase 2

| Grupo | P1 | P2 | P3 |
|---|---:|---:|---:|
| Personagens (corpo, esqueleto, cor por equipe, 4 conjuntos, boneco) | 3 | 4 | 1 |
| Animações | 9 | 0 | 1 |
| Armas e flecha | 0 | 6 | 0 |
| Construção | 6 | 2 | 1 |
| Objetos interativos | 3 | 5 | 1 |
| Estados destruídos | 3 | 0 | 0 |
| Consumíveis | 0 | 1 | 3 |

**Mínimo para começar a Fase 2:** corpo base com esqueleto e as 9 animações P1, as 6 peças de construção P1 e porta, barril e caixa (com versões destruídas). Todo o resto pode começar como caixa ou cilindro colorido e ser substituído depois.
