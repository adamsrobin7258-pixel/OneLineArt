import { defineConfig, devices } from '@playwright/test';

/** Reproducible performance measurements (`npm run bench`); not part of the test suite. */
export default defineConfig({
  testDir: 'e2e/benchmark',
  testMatch: '*.bench.ts',
  timeout: 900_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4182' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Dev server: the benchmark imports the modules directly (same code as the build, unminified).
  webServer: { command: 'npx vite --port 4182 --strictPort', url: 'http://localhost:4182', reuseExistingServer: false },
});
