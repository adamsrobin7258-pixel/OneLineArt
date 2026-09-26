import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build of the Phase 15.1 prototype test page ONLY (prototype/variable-width.html),
 * for the manual GitHub Pages workflow (.github/workflows/prototype-pages.yml).
 * The app's own build (vite.config.ts → dist/) is untouched by this file.
 *
 * base './': every asset and worker URL is relative, so the page works under
 * the GitHub Pages project path (/<repository>/prototype/variable-width.html).
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-prototype',
    emptyOutDir: true,
    rollupOptions: { input: 'prototype/variable-width.html' },
  },
});
