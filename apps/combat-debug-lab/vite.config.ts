import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Arte-fonte fica em `assets/` na raiz do repositório; servida na raiz do lab,
// ex.: /icons/items/weapon.iron_sword.png (ver @bardurinho/assets-manifest).
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  // Duas páginas: o Lab e o modo NETWORK (Fase 3).
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        network: fileURLToPath(new URL('./network.html', import.meta.url)),
      },
    },
  },
});
