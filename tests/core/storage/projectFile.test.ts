import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  PROJECT_FILE_VERSION,
  STORAGE_LIMITS,
  StorageError,
  assembleProject,
  createByteHasher,
  createMemoryStorageBackend,
  createProjectRepository,
  decodeProjectFile,
  decodeUtf8,
  encodeProjectFile,
  encodeUtf8,
  importedName,
  resolveOneLineSettings,
  type ArtworkProject,
  type BinarySource,
  type ProjectThumbnail,
} from '../../../src/core';

const bytes = (n: number, seed = 1): Uint8Array<ArrayBuffer> => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));
const hashOf = (b: Uint8Array) => {
  const h = createByteHasher();
  h.update(b);
  return h.digest();
};

function project(id: string, opts: { name?: string; imageBytes?: Uint8Array<ArrayBuffer>; style?: 'organic' | 'orthogonal' } = {}): ArtworkProject {
  const image = opts.imageBytes ?? bytes(64);
  const coords = new Float32Array([1, 2, 30.5, 40.25, 60, 10, 90, 70.125]);
  return assembleProject({
    id,
    name: opts.name ?? 'Oma am Meer',
    createdAt: '2026-03-01T08:00:00.000Z',
    now: new Date('2026-09-01T10:00:00Z'),
    image: {
      id: `img-${id}`,
      fileName: 'foto.jpg',
      source: new Blob([image], { type: 'image/jpeg' }),
      metadata: { format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: image.length, width: 4000, height: 3000, aspectRatio: 4 / 3, orientation: 6 },
      contentHash: hashOf(image),
    },
    edit: { rotation: 90, crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 } },
    oneLine: resolveOneLineSettings({ detailLevel: 'detail', seed: 42, style: opts.style ?? 'orthogonal' }),
    path: { coords, bounds: { width: 100, height: 75 }, meta: { generatorId: 'orthogonal-stipple-tour', generatorVersion: '1.0.0', seed: 42, sourceImageId: `img-${id}` } },
    render: { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color', lineWidth: 1.5 },
    animation: { durationMs: 7_500, fps: 30, pacing: 'constant-speed', easing: 'linear', speed: 2, direction: 'reverse', startPoint: { x: 0.25, y: 0.6 }, loop: true },
  });
}

const thumb = (): ProjectThumbnail => ({ data: new Blob([bytes(100, 7)], { type: 'image/webp' }), mimeType: 'image/webp', width: 512, height: 384 });
const toBinary = (b: Uint8Array, mimeType: string): BinarySource => new Blob([b.slice()], { type: mimeType });
const rejects = (file: Uint8Array, code: 'damaged' | 'incompatible-version') => {
  let error: unknown;
  try {
    decodeProjectFile(file);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(StorageError);
  expect((error as StorageError).code).toBe(code);
};
/** Rewrites the JSON manifest of a file (keeps everything else). */
function withManifest(file: Uint8Array, change: (m: Record<string, unknown>) => void): Uint8Array {
  const length = new DataView(file.buffer, file.byteOffset).getUint32(12, true);
  const manifest = JSON.parse(decodeUtf8(file.subarray(16, 16 + length))) as Record<string, unknown>;
  change(manifest);
  const json = encodeUtf8(JSON.stringify(manifest));
  const out = new Uint8Array(16 + json.length + file.length - 16 - length);
  out.set(file.subarray(0, 16));
  new DataView(out.buffer).setUint32(12, json.length, true);
  out.set(json, 16);
  out.set(file.subarray(16 + length), 16 + json.length);
  return out;
}

describe('13.6 project file (.onelineart)', () => {
  it('round trip: every setting, the untouched original, the exact path and the thumbnail come back', async () => {
    const p = project('a');
    const file = await encodeProjectFile(p, thumb());
    expect(decodeUtf8(file.subarray(0, 10))).toBe('ONELINEART');
    expect(file[10]).toBe(PROJECT_FILE_VERSION);
    const read = decodeProjectFile(file);
    expect(read.record).toMatchObject({ name: 'Oma am Meer', createdAt: '2026-03-01T08:00:00.000Z', edit: p.edit, render: p.render, animation: p.animation, versions: p.versions, favorite: false });
    expect(read.record.oneLine.drawing).toMatchObject({ style: 'orthogonal', detailLevel: 'detail', seed: 42 });
    expect(read.record.oneLine.key).toBe(p.oneLine.key);
    expect(read.record.image).toMatchObject({ fileName: 'foto.jpg', contentHash: p.image.contentHash, metadata: p.image.metadata });
    expect(Array.from(read.image.bytes)).toEqual(Array.from(bytes(64)));
    expect(read.image.mimeType).toBe('image/jpeg');
    expect(Array.from(read.coords)).toEqual(Array.from(p.path.coords));
    expect(read.thumbnail).toMatchObject({ mimeType: 'image/webp', width: 512, height: 384 });
    expect(Array.from(read.thumbnail!.bytes)).toEqual(Array.from(bytes(100, 7)));
  });

  it('the original is stored once; a file without thumbnail works too', async () => {
    const image = bytes(5000);
    const file = await encodeProjectFile(project('a', { imageBytes: image }), null);
    // Header + manifest + image + path, nothing duplicated.
    expect(file.length).toBeLessThan(image.length + 8 * 4 + 16 + 20_000);
    expect(decodeProjectFile(file).thumbnail).toBeNull();
  });

  it('rejects files that are not project files, clearly and without crashing', async () => {
    rejects(new Uint8Array(0), 'damaged');
    rejects(encodeUtf8('hello, this is not a project'), 'damaged');
    rejects(bytes(4096), 'damaged');
    const good = await encodeProjectFile(project('a'), thumb());
    rejects(good.subarray(0, good.length - 1), 'damaged'); // truncated
    const appended = new Uint8Array(good.length + 1);
    appended.set(good);
    rejects(appended, 'damaged'); // extra data
    const badManifest = good.slice();
    badManifest[20] = 0xff; // broken JSON / UTF-8
    rejects(badManifest, 'damaged');
  });

  it('rejects a changed original (content hash) or path; never trusts the sizes blindly', async () => {
    const good = await encodeProjectFile(project('a'), null);
    const length = new DataView(good.buffer).getUint32(12, true);
    const alteredImage = good.slice();
    alteredImage[16 + length + 3]! ^= 0xff;
    rejects(alteredImage, 'damaged');
    const nanPath = good.slice();
    new DataView(nanPath.buffer).setFloat32(16 + length + 64, NaN, true);
    rejects(nanPath, 'damaged');
    rejects(withManifest(good, (m) => ((m.sections as { image: { length: number } }).image.length = 10)), 'damaged');
  });

  it('unknown / newer versions are refused as incompatible, not as damaged', async () => {
    const good = await encodeProjectFile(project('a'), null);
    const newer = good.slice();
    newer[10] = PROJECT_FILE_VERSION + 1;
    rejects(newer, 'incompatible-version');
    // A newer project format inside the file.
    rejects(
      withManifest(good, (m) => ((m.project as { formatVersion: number }).formatVersion = 99)),
      'incompatible-version',
    );
    const zero = good.slice();
    zero[10] = 0;
    rejects(zero, 'damaged');
  });

  it('invalid settings inside the file are refused (the same strict checks as storage)', async () => {
    const good = await encodeProjectFile(project('a'), null);
    rejects(withManifest(good, (m) => ((m.project as { render: { lineWidth: number } }).render.lineWidth = 999)), 'damaged');
    rejects(withManifest(good, (m) => ((m.project as { animation: { direction: string } }).animation.direction = 'sideways')), 'damaged');
    rejects(withManifest(good, (m) => ((m.project as { animation: { loop: unknown } }).animation.loop = 'yes')), 'damaged');
    rejects(withManifest(good, (m) => ((m.project as { oneLine: { drawing: { style: string } } }).oneLine.drawing.style = 'cubist')), 'damaged');
    rejects(withManifest(good, (m) => ((m.project as { name: string }).name = 'x'.repeat(STORAGE_LIMITS.maxNameLength + 1))), 'damaged');
    rejects(withManifest(good, (m) => (m.kind = 'something-else')), 'damaged');
  });

  it('unknown extra fields are not taken over', async () => {
    const good = await encodeProjectFile(project('a'), null);
    const read = decodeProjectFile(withManifest(good, (m) => ((m.project as Record<string, unknown>).evil = { script: 'x' })));
    expect(read.record).not.toHaveProperty('evil');
  });
});

describe('13.6 importing into the repository', () => {
  it('a NEW project: new id and image id, same content, created date kept, changed = now, not a favourite', async () => {
    const backend = createMemoryStorageBackend();
    const repo = createProjectRepository(backend, { now: () => new Date('2026-09-24T12:00:00Z') });
    const source = project('a');
    await repo.save(source, thumb());
    await repo.setFavorite('a', true);
    const file = await encodeProjectFile((await repo.load('a')).project, thumb());

    const result = await repo.importProject(decodeProjectFile(file), { id: 'b', imageId: 'img-new', toBinary });
    expect(result).toEqual({ id: 'b', name: 'Oma am Meer – Import' });
    const imported = (await repo.load('b')).project;
    expect(imported).toMatchObject({ id: 'b', name: 'Oma am Meer – Import', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-09-24T12:00:00.000Z', edit: source.edit, render: source.render, animation: source.animation });
    expect(imported.image.id).toBe('img-new');
    expect(imported.path.meta.sourceImageId).toBe('img-new');
    expect(Array.from(imported.path.coords)).toEqual(Array.from(source.path.coords));
    expect(imported.oneLine.key).toBe(source.oneLine.key);
    const list = await repo.list();
    expect(list.find((s) => s.id === 'b')).toMatchObject({ favorite: false, style: 'orthogonal', status: 'ok' });
    // The original is untouched and still a favourite; the photo is stored once.
    expect((await repo.load('a')).project).toMatchObject({ name: 'Oma am Meer', image: { id: 'img-a' } });
    expect(list.find((s) => s.id === 'a')!.favorite).toBe(true);
    expect(backend.stores.get('images')!.size).toBe(1);
  });

  it('never overwrites: an existing id is refused; names stay unique', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    await repo.save(project('a'), null);
    const file = decodeProjectFile(await encodeProjectFile(project('x'), null));
    await expect(repo.importProject(file, { id: 'a', imageId: 'i', toBinary })).rejects.toMatchObject({ code: 'invalid-project' });
    expect((await repo.load('a')).project.image.id).toBe('img-a');
    expect((await repo.importProject(file, { id: 'b', imageId: 'i1', toBinary })).name).toBe('Oma am Meer – Import');
    expect((await repo.importProject(file, { id: 'c', imageId: 'i2', toBinary })).name).toBe('Oma am Meer – Import 2');
    expect((await repo.importProject(file, { id: 'd', imageId: 'i3', toBinary })).name).toBe('Oma am Meer – Import 3');
    expect((await repo.list()).map((s) => s.name).sort()).toEqual(['Oma am Meer', 'Oma am Meer – Import', 'Oma am Meer – Import 2', 'Oma am Meer – Import 3']);
  });

  it('an imported project behaves like any other: save changes, export again, duplicate, delete', async () => {
    const backend = createMemoryStorageBackend();
    const repo = createProjectRepository(backend);
    await repo.importProject(decodeProjectFile(await encodeProjectFile(project('x'), thumb())), { id: 'b', imageId: 'ib', toBinary });
    const loaded = (await repo.load('b')).project;
    await repo.save({ ...loaded, render: { ...loaded.render, lineWidth: 3 } }, null);
    expect((await repo.load('b')).project.render.lineWidth).toBe(3);
    const again = decodeProjectFile(await encodeProjectFile((await repo.load('b')).project, null));
    expect(again.record.render.lineWidth).toBe(3);
    await repo.rename('b', 'Neu');
    await repo.duplicate('b', 'c', 'Neu – Kopie');
    await repo.remove('b');
    expect((await repo.list()).map((s) => s.id)).toEqual(['c']);
    await repo.remove('c');
    expect(await repo.list()).toEqual([]);
    expect(backend.stores.get('images')!.size).toBe(0);
  });

  it('import names: free names stay, unnamed works stay unnamed, long names stay within the limit', () => {
    expect(importedName('  Hafen  ', ['Oma'])).toBe('Hafen');
    expect(importedName('Hafen', ['hafen'])).toBe('Hafen – Import');
    expect(importedName('', ['', 'x'])).toBe('');
    const long = 'L'.repeat(STORAGE_LIMITS.maxNameLength);
    const named = importedName(long, [long]);
    expect(named.length).toBeLessThanOrEqual(STORAGE_LIMITS.maxNameLength);
    expect(named.endsWith(' – Import')).toBe(true);
  });
});

describe('utf-8 helpers', () => {
  it('round trip incl. umlauts, emoji; invalid bytes throw', () => {
    for (const text of ['', 'Oma am Meer', 'Größe – ü', '🐈 Katze', '{"a":"ß"}']) expect(decodeUtf8(encodeUtf8(text))).toBe(text);
    expect(Array.from(encodeUtf8('ä'))).toEqual([0xc3, 0xa4]);
    expect(() => decodeUtf8(new Uint8Array([0xc3]))).toThrow(RangeError);
    expect(() => decodeUtf8(new Uint8Array([0xc0, 0x80]))).toThrow(RangeError);
    expect(() => decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toThrow(RangeError);
  });
});
