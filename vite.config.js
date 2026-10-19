import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from https://<user>.github.io/beach-buggy/
  base: command === 'build' ? '/beach-buggy/' : '/',
  server: { host: '0.0.0.0', port: 5173 },
  build: { chunkSizeWarningLimit: 4000 },
}));
