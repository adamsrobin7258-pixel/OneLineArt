import { describe, expect, it } from 'vitest';
import {
  ARTWORK_PROJECT_SCHEMA_VERSION,
  DEFAULT_ANIMATION_SETTINGS,
  DEFAULT_ONE_LINE_SETTINGS,
  DEFAULT_RENDER_STYLE,
  createMemoryRepository,
  type ArtworkProject,
} from '../../src/core';
import { blankImage } from '../helpers';

const project = (id: string, updatedAt: string): ArtworkProject => ({
  schemaVersion: ARTWORK_PROJECT_SCHEMA_VERSION,
  id,
  name: id,
  createdAt: updatedAt,
  updatedAt,
  image: { id: 'img', fileName: 'a.jpg', mimeType: 'image/jpeg', pixels: blankImage(), contentHash: '00000000' },
  settings: DEFAULT_ONE_LINE_SETTINGS,
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
