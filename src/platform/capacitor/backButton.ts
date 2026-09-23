import { App } from '@capacitor/app';
import { isAndroidApp } from './runtime';

/**
 * Android system back: `handler` returns true if it handled the action inside
 * the app; otherwise the app goes to the background like other Android apps
 * at their start screen (the current work stays in memory). No-op in browsers.
 */
export function onSystemBack(handler: () => boolean): () => void {
  if (!isAndroidApp()) return () => {};
  const listener = App.addListener('backButton', () => {
    if (!handler()) void App.minimizeApp();
  });
  return () => void listener.then((l) => l.remove());
}
