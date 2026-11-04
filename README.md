# Bardurinho RPG — RPG tático de arena

MVP de um RPG tático por turnos para navegador. Plano completo em [docs/plano_mvp_rpg_tatico.md](docs/plano_mvp_rpg_tatico.md).

**Fase atual:** 5 — Ciclo completo do jogo ([fase 5](docs/fase-05.md); anteriores: [1](docs/fase-01.md), [2](docs/fase-02.md), [3](docs/fase-03.md), [4](docs/fase-04.md)).

```bash
npm install
npm test                  # testes unitários, cenários e integração do servidor
npm run typecheck
npm run validate-content
npm run lab               # Combat Debug Lab: http://127.0.0.1:5174 (modo NETWORK em /network.html)
npm run web               # cliente 3D: http://127.0.0.1:5173 (jogo completo: login → lobby → partida) · ?mode=local · ?mode=rede
npm run server            # servidor de jogo: http://127.0.0.1:2567 (Colyseus + PGlite em .data/pg)
npm run e2e:rede          # critério da Fase 3: partida completa entre dois clientes pelo servidor
npm run e2e:rede-ui       # idem pela interface, em dois Chrome headless (precisa do npm run web)
npm run e2e:ciclo         # critério da Fase 5: cadastro → personagem → loja → bot → recompensas → lobby + fila/convite
npm run bots:sim          # simulação em lote bot × bot (fácil/normal/difícil)
```

Monorepo com npm workspaces: `packages/domain` (regras), `packages/content` (catálogo), `packages/protocol` (rede e API HTTP), `packages/ai` (bots), `apps/combat-debug-lab` (laboratório 2D), `apps/web` (cliente 3D Babylon.js), `apps/server` (servidor autoritativo Colyseus + PostgreSQL/PGlite).

## Assets

- `assets/icons/items/` — ícones das armas (256 px; originais em `master/`). Mapa id → arquivo em `packages/assets-manifest`.
- `assets/models/characters/` — modelos das 4 classes (placeholders estáticos; ver `docs/modelos-classes.md`).
- `assets/models/environment/` — base circular ornamentada (ver `docs/modelos-cenario.md`).
- `npm run screenshots` gera imagens dos cenários de teste em `tests/output/`.
