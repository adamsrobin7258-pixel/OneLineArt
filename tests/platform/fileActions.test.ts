import { describe, expect, it, vi } from 'vitest';

describe('platform selection for saving/sharing exports', () => {
  it('browser: download + Web Share', async () => {
    vi.resetModules();
    const { exportFileActions } = await import('../../src/platform/fileActions');
    expect(exportFileActions().saveKind).toBe('download');
    // No "save as" dialog in the browser: project files stay a normal download.
    expect(exportFileActions().saveAs).toBeUndefined();
  });

  it('Android app: gallery + native share sheet', async () => {
    vi.resetModules();
    vi.doMock('@capacitor/core', async (importOriginal) => {
      const real = await importOriginal<typeof import('@capacitor/core')>();
      return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => true, getPlatform: () => 'android' } };
    });
    const { exportFileActions } = await import('../../src/platform/fileActions');
    const actions = exportFileActions();
    expect(actions.saveKind).toBe('gallery');
    expect(actions.canShare({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 1, data: new Blob(['x']) })).toBe(true);
    expect(typeof actions.saveAs).toBe('function');
    vi.doUnmock('@capacitor/core');
  });
});
