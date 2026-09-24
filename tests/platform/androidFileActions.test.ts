import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  ExportError,
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_MIME_TYPE,
  assembleProject,
  createByteHasher,
  decodeProjectFile,
  encodeProjectFile,
  exportFileName,
  resolveOneLineSettings,
  type ExportFile,
} from '../../src/core';
import { TRANSFER_CHUNK_BYTES, createAndroidFileActions } from '../../src/platform/capacitor/androidFileActions';
import type { MediaExportPlugin } from '../../src/platform/capacitor/mediaExportPlugin';

/** In-memory stand-in for the native plugin: records calls and reassembles the file. */
function fakePlugin(opts: { failAppendAt?: number; failSave?: boolean; saveAs?: 'saved' | 'cancelled' | 'failed' } = {}) {
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
    async saveAs({ id, mimeType, fileName }) {
      calls.push(`saveAs:${id}:${mimeType}:${fileName}`);
      if (opts.saveAs === 'failed') throw new Error('Saving the file failed');
      return opts.saveAs === 'cancelled' ? { saved: false } : { saved: true, uri: `content://documents/${id}` };
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

  describe('"Speichern" of a project file via the system file dialog (saveAs)', () => {
    /** A real ".onelineart" file, exactly as the project-file export makes it. */
    async function projectFile(): Promise<ExportFile<Blob>> {
      const image = new Uint8Array(3000).map((_, i) => (i * 17 + 3) & 255);
      const h = createByteHasher();
      h.update(image);
      const project = assembleProject({
        id: 'p',
        name: 'Hafen',
        createdAt: null,
        now: new Date('2026-09-24T10:00:00Z'),
        image: { id: 'i', fileName: 'f.jpg', source: new Blob([image], { type: 'image/jpeg' }), metadata: { format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: image.length, width: 40, height: 30, aspectRatio: 4 / 3, orientation: 1 }, contentHash: h.digest() },
        oneLine: resolveOneLineSettings({ style: 'orthogonal' }),
        path: { coords: new Float32Array([0, 0, 10, 0, 10, 5]), bounds: { width: 40, height: 30 }, meta: { generatorId: 'orthogonal-stipple-tour', generatorVersion: '1.0.0', seed: 1, sourceImageId: 'i' } },
        render: DEFAULT_RENDER_SETTINGS,
        animation: { durationMs: 10_000, fps: 30, pacing: 'constant-speed', loop: true },
      });
      const bytes = await encodeProjectFile(project, null);
      const data = new Blob([bytes], { type: PROJECT_FILE_MIME_TYPE });
      const fileName = exportFileName({ projectName: project.name, date: new Date(2026, 8, 24, 14, 30), extension: PROJECT_FILE_EXTENSION });
      return { fileName, mimeType: PROJECT_FILE_MIME_TYPE, sizeBytes: data.size, data };
    }

    it('opens the dialog with the safe name (.onelineart) and hands over exactly the export bytes', async () => {
      const fake = fakePlugin();
      const actions = createAndroidFileActions(fake.plugin);
      const f = await projectFile();
      expect(f.fileName).toBe('Hafen 2026-09-24 1430.onelineart');
      expect(await actions.saveAs!(f)).toBe(true);
      expect(fake.calls).toEqual(['begin', 'append', 'saveAs:f0:application/octet-stream:Hafen 2026-09-24 1430.onelineart']);
      // Byte-identical to the project-file export, and still a valid project file.
      const sent = fake.bytesOf('f0');
      expect(sent.equals(Buffer.from(await f.data.arrayBuffer()))).toBe(true);
      expect(decodeProjectFile(new Uint8Array(sent)).record.name).toBe('Hafen');
      expect(fake.files.get('f0')).toMatchObject({ name: 'Hafen 2026-09-24 1430.onelineart', mime: 'application/octet-stream' });
    });

    it('cancelling the dialog is not an error; trying again needs no new transfer', async () => {
      const fake = fakePlugin({ saveAs: 'cancelled' });
      const actions = createAndroidFileActions(fake.plugin);
      const f = await projectFile();
      expect(await actions.saveAs!(f)).toBe(false);
      expect(await actions.saveAs!(f)).toBe(false);
      expect(fake.calls.filter((c) => c === 'begin')).toHaveLength(1);
    });

    it('a real failure is reported as save-failed and can be retried', async () => {
      const fake = fakePlugin({ saveAs: 'failed' });
      const actions = createAndroidFileActions(fake.plugin);
      const f = await projectFile();
      await expect(actions.saveAs!(f)).rejects.toMatchObject({ code: 'save-failed' });
      await expect(actions.saveAs!(f)).rejects.toBeInstanceOf(ExportError);
      expect(fake.calls.filter((c) => c.startsWith('saveAs:'))).toHaveLength(2);
    });

    it('"Teilen" still works unchanged, with the same cached file (one transfer for both)', async () => {
      const fake = fakePlugin();
      const actions = createAndroidFileActions(fake.plugin);
      const f = await projectFile();
      expect(actions.canShare(f)).toBe(true);
      await actions.saveAs!(f);
      expect(await actions.share(f)).toBe(true);
      expect(fake.calls).toEqual(['begin', 'append', 'saveAs:f0:application/octet-stream:Hafen 2026-09-24 1430.onelineart', 'share:f0']);
      // Sharing alone (without saving first) behaves exactly as before.
      const other = fakePlugin();
      await createAndroidFileActions(other.plugin).share(await projectFile());
      expect(other.calls).toEqual(['begin', 'append', 'share:f0']);
    });
  });
});
