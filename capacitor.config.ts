import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native container (Android now, iOS later). The app is the unchanged web
 * build in `dist`, bundled into the APK and served locally by Capacitor
 * (https://localhost) — no dev server, no network needed to start.
 */
const config: CapacitorConfig = {
  appId: 'com.onelineart.app',
  appName: 'One Line Art',
  webDir: 'dist',
};

export default config;
