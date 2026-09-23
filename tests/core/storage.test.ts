import { describe, expect, it } from 'vitest';
import {
  ARTWORK_PROJECT_SCHEMA_VERSION,
  DEFAULT_ANIMATION_SETTINGS,
  resolveOneLineSettings,
  DEFAULT_RENDER_STYLE,
  createMemoryRepository,
  type ArtworkProject,
} from '../../src/core';

const project = (id: string, updatedAt: string): ArtworkProject => ({
  schemaVersion: ARTWORK_PROJECT_SCHEMA_VERSION,
  id,
  name: id,
  createdAt: updatedAt,
  updatedAt,
  image: {
    id: 'img',
    fileName: 'a.jpg',
    source: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
    metadata: { format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: 3, width: 64, height: 48, aspectRatio: 64 / 48, orientation: 1 },
    contentHash: '00000000',
  },
  oneLine: resolveOneLineSettings(),
  renderStyle: DEFAULT_RENDER_STYLE,
  animation: DEFAULT_ANIMATION_SETTINGS,
  path: null,
});

describe('memory project repository', () => {
  it('saves, lists newest first, loads and removes', async () => {
    const repo = createMemoryRepository();
    await repo.save(project('a', '2026-01-01'));
    await repo.save(project('b', '2026-02-01'));
    expect((await repo.list()).map((p) => p.id)).toEqual(['b', 'a']);
    expect((await repo.load('a'))?.name).toBe('a');
    await repo.remove('a');
    expect(await repo.load('a')).toBeNull();
  });
});
