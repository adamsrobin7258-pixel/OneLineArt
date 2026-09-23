import { describe, expect, it } from 'vitest';
import { ExportError, type ExportFile } from '../../src/core';
import { TRANSFER_CHUNK_BYTES, createAndroidFileActions } from '../../src/platform/capacitor/androidFileActions';
import type { MediaExportPlugin } from '../../src/platform/capacitor/mediaExportPlugin';

/** In-memory stand-in for the native plugin: records calls and reassembles the file. */
function fakePlugin(opts: { failAppendAt?: number; failSave?: boolean } = {}) {
  const files = new Map<string, { name: string; mime: string; chunks: string[] }>();
  const calls: string[] = [];
  let next = 0;
  const plugin: MediaExportPlugin = {
    async begin({ fileName, mimeType }) {
      calls.push('begin');
      const id = `f${next++}`;
      files.set(id, { name: fileName, mime: mimeType, chunks: [] });
      return { id };
    },
    async append({ id, data }) {
      const f = files.get(id)!;
      if (opts.failAppendAt === f.chunks.length) throw new Error('disk full');
      calls.push('append');
      f.chunks.push(data);
    },
    async saveToGallery({ id, kind }) {
      calls.push(`save:${kind}`);
      if (opts.failSave) throw new Error('MediaStore insert failed');
      return { uri: `content://media/${id}`, location: kind === 'video' ? 'Filme/One Line Art' : 'Bilder/One Line Art' };
    },
    async share({ id }) {
      calls.push(`share:${id}`);
    },
    async discard({ id }) {
      calls.push(`discard:${id}`);
      files.delete(id);
    },
  };
  const bytesOf = (id: string) => Buffer.concat(files.get(id)!.chunks.map((c) => Buffer.from(c, 'base64')));
  return { plugin, calls, files, bytesOf };
}

const file = (size: number, mimeType = 'image/png', fileName = 'OneLine_2026-09-23_1430.png'): ExportFile<Blob> => {
  const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 255);
  return { fileName, mimeType, sizeBytes: size, data: new Blob([bytes], { type: mimeType }) };
};

describe('Android file actions (native save / share adapter)', () => {
  it('streams the file in chunks (never one huge string) and reassembles it byte-exact', async () => {
    const fake = fakePlugin();
    const actions = createAndroidFileActions(fake.plugin);
    const f = file(TRANSFER_CHUNK_BYTES * 2 + 12345);
    const result = await actions.save(f);
    expect(result).toEqual({ location: 'Bilder/One Line Art' });
    expect(fake.calls).toEqual(['begin', 'append', 'append', 'append', 'save:image']);
    for (const c of fake.files.get('f0')!.chunks) expect(c.length).toBeLessThanOrEqual((TRANSFER_CHUNK_BYTES / 3) * 4);
    expect(fake.bytesOf('f0').equals(Buffer.from(await f.data.arrayBuffer()))).toBe(true);
    expect(fake.files.get('f0')).toMatchObject({ name: f.fileName, mime: 'image/png' });
  });

  it('videos go to the video collection; save + share transfer the file only once', async () => {
    const fake = fakePlugin();
    const actions = createAndroidFileActions(fake.plugin);
    const video = file(1000, 'video/mp4', 'OneLine_2026-09-23_1430.mp4');
    expect((await actions.save(video)).location).toBe('Filme/One Line Art');
    expect(await actions.share(video)).toBe(true);
    expect(fake.calls).toEqual(['begin', 'append', 'save:video', 'share:f0']);
  });

  it('empty files and sharing always work on Android', async () => {
    const fake = fakePlugin();
    const actions = createAndroidFileActions(fake.plugin);
    expect(actions.saveKind).toBe('gallery');
    expect(actions.canShare(file(0))).toBe(true);
    await actions.share(file(0));
    expect(fake.calls).toEqual(['begin', 'share:f0']);
  });

  it('a failed transfer is cleaned up, reported as save-failed and can be retried', async () => {
    const fake = fakePlugin({ failAppendAt: 1 });
    const actions = createAndroidFileActions(fake.plugin);
    const f = file(TRANSFER_CHUNK_BYTES + 10);
    await expect(actions.save(f)).rejects.toMatchObject({ code: 'save-failed' });
    expect(fake.calls).toEqual(['begin', 'append', 'discard:f0']);
    // Retry starts a fresh transfer (the failed one is not cached).
    await expect(actions.save(f)).rejects.toBeInstanceOf(ExportError);
    expect(fake.calls.filter((c) => c === 'begin')).toHaveLength(2);
  });

  it('a gallery failure is reported; sharing the same file still works without a new transfer', async () => {
    const fake = fakePlugin({ failSave: true });
    const actions = createAndroidFileActions(fake.plugin);
    const f = file(500);
    await expect(actions.save(f)).rejects.toMatchObject({ code: 'save-failed' });
    await actions.share(f);
    expect(fake.calls).toEqual(['begin', 'append', 'save:image', 'share:f0']);
  });
});
