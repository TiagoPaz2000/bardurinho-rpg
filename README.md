# Bardurinho RPG — RPG tático de arena

MVP de um RPG tático por turnos para navegador. Plano completo em [docs/plano_mvp_rpg_tatico.md](docs/plano_mvp_rpg_tatico.md).

**Fase atual:** 1 — Core de Gameplay + Combat Debug Lab ([acompanhamento](docs/fase-01.md)).

```bash
npm install
npm test                  # testes + cenários
npm run typecheck
npm run validate-content
npm run lab               # Combat Debug Lab: http://127.0.0.1:5174
```

Monorepo com npm workspaces: `packages/domain` (regras), `packages/content` (catálogo), `packages/protocol` (rede), `apps/combat-debug-lab` (laboratório 2D).

## Assets

- `assets/icons/items/` — ícones das armas (256 px; originais em `master/`). Mapa id → arquivo em `packages/assets-manifest`.
- `assets/models/characters/` — modelos das 4 classes (placeholders estáticos; ver `docs/modelos-classes.md`).
- `assets/models/environment/` — base circular ornamentada (ver `docs/modelos-cenario.md`).
- `npm run screenshots` gera imagens dos cenários de teste em `tests/output/`.
