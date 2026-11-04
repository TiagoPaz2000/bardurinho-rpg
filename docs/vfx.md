# VFX de combate

Os efeitos foram construídos no Blender 5.2 e exportados como 22 GLBs emissivos,
com uma malha por efeito. A fonte editável fica em `art/vfx/combat-vfx.blend`;
`art/vfx/preview.png` mostra as formas em uma folha de contato. As coleções estão
organizadas na mesma ordem do manifesto `assets/models/vfx/manifest.json`.
Cada efeito é exportado na origem; o espaçamento da folha existe apenas na fonte.
As curvas permanecem editáveis no Blender, com conversão de cópias para exportação.

## Cliente (Fase 2, etapa 4)

Nada no cliente decide resultado: cada efeito é disparado por um evento aceito do core
(ou reconciliado a partir do `GameState` em `ArenaView.sync`).

| Arquivo | Papel |
|---|---|
| `apps/web/src/rendering/vfx.ts` | `CombatVfx`: evento → animação do executor + efeito; GLBs do manifesto; projéteis, impactos, explosão |
| `apps/web/src/rendering/fx/particles.ts` | `ParticleFx`: partículas procedurais em pool (fogo, faíscas, fumaça, cura, gelo, rastro, poeira, brilho) |
| `apps/web/src/rendering/fx/stateFx.ts` | `StateFx`: efeitos persistentes espelhando o estado (superfícies, barreira, estados, objetos em chamas) |
| `apps/web/src/rendering/unitAnimator.ts` | `UnitAnimator`: animações falsas dos personagens (modelos sem esqueleto) |
| `apps/web/src/rendering/objects.ts` | destroços dos objetos destruídos; portas/tampas/alavancas/grade animadas |
| `apps/web/src/rendering/anim.ts` | `tween`/`wait` pelo relógio da cena + ritmo da reprodução (`pace`, tecla T) |

**Cores.** Os GLBs trazem PBR com emissão × 1,6 somada à luz da cena, o que estourava as
cores para amarelo/branco. Ao instanciar, cada malha recebe um material sem luz
(`Materials.unlit`) com a cor exata do manifesto (lido de `/models/vfx/manifest.json`, com
reserva embutida). Halos, anéis e fogo usam mistura alfa comum (a aditiva somava o piso
claro e deixava tudo cor de pêssego); só faíscas e o rastro dos projéteis são aditivos.
Os 22 GLBs são pré-carregados junto com a cena (`CombatVfx.ready` entra no
`ArenaView.whenLoaded`), então o primeiro disparo não trava.

### Evento → efeito

| Evento | Efeito |
|---|---|
| `ATTACK_PERFORMED` / `ABILITY_USED` / `ITEM_USED` | animação do executor pelo `presentation.animationId`; no instante de "soltar": projétil (`projectile.*`, `trail.arrow`, `item.oil` em arco; Espinheiro e Enraizar lançam `projectile.nature`), corte `impact.physical` (espada/adaga), `impact.wave` + poeira (Empurrão), `charge.dust` + poeira (Investida) |
| `ATTACK_ROLLED` com `hit = false` (etapa 5) | a reprodução olha adiante e avisa a ação antes de animá-la: o projétil desvia ~1,5 m para o lado do alvo, segue ~4 m além e some; golpe corpo a corpo sem corte/onda no alvo (só poeira); o alvo faz `dodge` |
| `DAMAGE_APPLIED` (PV) | `damage.<tipo>` (physical/fire/cold/arcane/nature) + faíscas na cor do tipo; alvo recua para longe da origem (atacante, objeto ou centro da explosão) com lampejo vermelho |
| `DAMAGE_APPLIED` (barreira) | pulso da bolha + `barrier.arcane`; a bolha some quando `shieldAfter` = 0 |
| `OBJECT_DAMAGED` | impacto do tipo no objeto |
| `OBJECT_DESTROYED` | barril/caixote/porta viram destroços que voam e ficam no chão (tábuas, aros, lascas, fuligem) + poeira; demais objetos somem |
| `EXPLOSION` | bola de fogo (núcleo + casca), `explosion.fire` × 2,8, onda de choque até a borda de `cells`, as `cells` acendem, 90 faíscas, 26 de fumaça, tremor leve da câmera (0,4 m, 0,45 s) |
| `HEALED` | partículas subindo + `heal.nature` (Cura natural) ou `item.health` (poção) + lampejo verde/rosa |
| `RESOURCE_RESTORED` (Poção de Foco) | partículas + `item.focus` |
| `SHIELD_GRANTED` (aplicada) | `barrier.arcane` + partículas; bolha arcana persistente (esfera com fresnel) enquanto houver barreira |
| `SHIELD_EXPIRED` | a bolha se abre e desaparece |
| `STATUS_APPLIED` / `STATUS_REFRESHED` | `burning`: chamas no corpo · `slowed`: tinta azul gelo + flocos caindo · `rooted`: GLB `status.roots` nos pés (cresce) · `hidden`: `stealth.transition`, personagem translúcido (≈ 30 %) com tinta lilás e cintilação |
| `STATUS_REMOVED` / `STATUS_EXPIRED` | desliga o efeito (raízes encolhem, fumaça ao apagar as chamas, `stealth.transition` ao sair da ocultação) |
| `SURFACE_CREATED` | óleo: poça escura brilhante (decalque) · fogo: chamas por célula + brasa cintilando no chão · espinhos: decalque + 2 GLBs `surface.thorns` por célula, crescendo; pequeno escalonamento entre células |
| `SURFACE_REMOVED` / `SURFACE_EXPIRED` | a superfície encolhe e some (fogo solta fumaça) |
| `OBJECT_IGNITED` / `OBJECT_EXTINGUISHED` | chamas sobre o objeto (além da tinta laranja) / fumaça |
| `OBJECT_STATE_CHANGED` | quem interagiu se inclina para o objeto; porta, tampa do baú, alavanca e grade se movem (0,3–0,6 s) |
| `UNIT_DEFEATED` | poeira + animação de morte; efeitos de estado são removidos |

`ArenaView.sync(state)` reconcilia superfícies, barreiras, estados e objetos em chamas
com o estado oficial (cobre o óleo inicial do mapa e qualquer evento não reproduzido).

### Animações dos personagens

Os modelos não têm esqueleto: `UnitView` tem `root` (posição) → `pose` (deslocamentos,
giro, respiração) → `model` (direção, inclinação, escala).

| id | movimento |
|---|---|
| `idle` | respiração (escala vertical ±1,4 %) e balanço leve, contínuos |
| `walk` / `run` | pulinho por passo (`eventPlayback.playStep`) |
| `melee` | recua, investe ~0,8 m na direção do alvo, volta (0,5 s; golpe aos 50 %) |
| `shoot` | inclina para trás, recuo curto ao soltar; brilho nas mãos (0,5 s) |
| `cast_forward` | inclina para trás juntando brilho nas mãos, empurra para a frente (0,55 s) |
| `cast_self` | sobe e gira uma volta; anel de brilho nos pés (0,65 s) |
| `hit` | recuo para longe da origem + lampejo vermelho (0,32 s) |
| `dodge` | esquiva: passo lateral e inclinação, perpendicular à origem do ataque (0,42 s; etapa 5) |
| `death` | tomba para trás, afunda e desaparece (0,95 s) |
| `interact` | inclina e dá meio passo em direção ao objeto (0,45 s) |

Mapeamento: `presentation.animationId` da habilidade/arma; poções usam `cast_self` e o
Frasco de óleo `shoot`. Cores do brilho nas mãos = cor do `vfxId` no manifesto.

### Ritmo

Ordem de uma ação: animação do executor → projétil (0,3–0,55 s conforme a distância) →
selo do d20 (0,5 s) → dados (0,3 s) → impacto/número (≈ 0,2 s) → reações (explosão,
superfícies). Um ataque típico leva ≈ 1,5–2 s. "Rápido" (tecla **T** ou o botão acima de
"Encerrar turno", guardado no `localStorage`) divide por 2 todas as durações e pausas da
sequência. Para capturas, `window.__pace.speed = 0.25` desacelera 4×.

### Desempenho

- Partículas: `ParticleSystem` de CPU, criados sob demanda e devolvidos a um pool por
  predefinição (nada é descartado durante a partida). Capacidades: fogo de superfície 42
  por célula (≈ 24/s), objeto em chamas 42 (≈ 19/s), personagem em chamas 22, lentidão 18,
  oculto 16, rastro 40, faíscas 90, fumaça 30, cura 40. Em andar fantasma os sistemas
  continuam emitindo, translúcidos (`ParticleHandle.setOpacity` escala o alfa dos gradientes
  para `GHOST_ENTITY_VISIBILITY` = 0,35, a mesma do personagem, da barra e dos rótulos).
- Texturas (brilho, faísca, fumaça, manchas das superfícies) são geradas uma vez em canvas;
  materiais são compartilhados por chave. Sem luzes dinâmicas (trocariam os shaders de todos
  os materiais); a "luz" do fogo é a brasa cintilando no chão.
- Efeitos transitórios (GLBs, bola de fogo, anéis, halos) são descartados ao terminar.
- Medição no Chrome headless com SwiftShader (CPU): ~13–16 fps antes e depois de uma
  explosão com 3 células em chamas; numa GPU comum a cena fica no limite de quadros.

### Bola de fogo (`projectile.fireball`)

O projétil vem da arte editável `art/vfx/fireball/fireball-stylized.blend`. O script
`tools/vfx/export_fireball_glb.py` pega o núcleo, as chamas, as bordas e as faíscas no quadro 1,
deixando a fumaça de fora porque o jogo pinta cada GLB com uma cor só. Ele aponta a cabeça para +Z,
reduz o modelo a 1 400 triângulos (orçamento de efeito) e acrescenta a entrada ao manifesto sem
reconstruir os outros efeitos. No jogo, a bola sobe em arco e cai no centro da área, maior que os
outros projéteis. Ao tocar o chão, toca `explosion(center, area)`: clarão, onda de choque até a
borda e as 3×3 células acendendo. A área chega em `ABILITY_USED.payload.area`. Cada teste de
resistência (`SAVE_ROLLED`) mostra um selo sobre o personagem: "Resistência 14 vs CD 13 — PASSOU,
metade do dano" ou "FALHOU". A animação de impacto no chão (`art/vfx/fireball-impact/`) continua
como referência em .blend/MP4: o fogo que fica é o estado Queimando e as reações de calor, que já
têm efeitos próprios.

## Reprodução e verificação

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python tools/vfx/build.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background art/vfx/fireball/fireball-stylized.blend --disable-autoexec --python tools/vfx/export_fireball_glb.py
npx.cmd tsx tools/vfx/verify.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build -w @bardurinho/web
```

A animação é controlada pelo cliente Babylon; os GLBs contêm geometria e materiais,
sem clipes de animação. A fonte Blender permite ajustar as formas; o script reproduz
os assets originais de maneira determinística e sobrescreve os arquivos gerados.
O teste de assets usa Babylon NullEngine para validar carregamento, cobertura do
catálogo, descarte das instâncias e cancelamento ao encerrar a cena. Ele não substitui
a inspeção visual de uma partida em navegador com GPU — as capturas da etapa 4 estão em
[`screenshots/fase-02/passo-4/`](screenshots/fase-02/passo-4/).

Para ver classes que o cenário de exemplo não traz: `?units=druid@4,12;warrior@8,12`
troca a classe (e a posição) dos personagens do cenário, na ordem; `?seed=N` repete os dados.
