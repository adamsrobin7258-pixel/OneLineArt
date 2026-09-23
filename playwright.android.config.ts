import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of the web assets exactly as they are packaged into the Android
 * app (android/app/src/main/assets/public, after `npm run android:sync`),
 * served from a local origin like Capacitor does, on an emulated Android
 * phone (touch, Pixel 7). This is Chromium, not a real device/WebView.
 */
export default defineConfig({
  testDir: 'e2e/android',
  timeout: 240_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4183', ...devices['Pixel 7'] },
  projects: [{ name: 'android-bundle' }],
  webServer: { command: 'npx vite preview --outDir android/app/src/main/assets/public --port 4183 --strictPort', url: 'http://localhost:4183', reuseExistingServer: false },
});
