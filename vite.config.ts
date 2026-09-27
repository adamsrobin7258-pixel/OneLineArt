/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Phase 16: the Organic presets draw up to ~3× more line (closer spacing); whole-engine tests take longer.
    testTimeout: 30_000,
  },
});
