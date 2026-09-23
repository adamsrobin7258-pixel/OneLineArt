import type { ExportFileActions } from '../core';
import { browserFileActions } from './browser/export/share';
import { createAndroidFileActions } from './capacitor/androidFileActions';
import { MediaExport } from './capacitor/mediaExportPlugin';
import { isAndroidApp } from './capacitor/runtime';

let actions: ExportFileActions<Blob> | null = null;

/** Save/share for finished exports on the current platform (browser or Android app). */
export function exportFileActions(): ExportFileActions<Blob> {
  return (actions ??= isAndroidApp() ? createAndroidFileActions(MediaExport) : browserFileActions);
}
