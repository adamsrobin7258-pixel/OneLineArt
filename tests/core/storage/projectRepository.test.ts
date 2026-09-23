import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSIONS,
  DEFAULT_RENDER_SETTINGS,
  STORAGE_LIMITS,
  StorageError,
  IDENTITY_EDIT,
  assembleProject,
  createMemoryStorageBackend,
  createProjectRepository,
  resolveOneLineSettings,
  type ArtworkProject,
  type ProjectThumbnail,
} from '../../../src/core';

const bytes = (n: number, seed = 1): Uint8Array<ArrayBuffer> => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));

function project(id: string, opts: { hash?: string; updated?: string; name?: string; imageBytes?: Uint8Array<ArrayBuffer> } = {}): ArtworkProject {
  const image = opts.imageBytes ?? bytes(64);
  const coords = new Float32Array([1, 2, 30.5, 40.25, 60, 10, 90, 70]);
  return assembleProject({
    id,
    name: opts.name ?? '',
    createdAt: null,
    now: new Date(opts.updated ?? '2026-09-01T10:00:00Z'),
    image: {
      id: `img-${id}`,
      fileName: 'foto.jpg',
      source: new Blob([image], { type: 'image/jpeg' }),
      metadata: { format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: image.length, width: 4000, height: 3000, aspectRatio: 4 / 3, orientation: 6 },
      contentHash: opts.hash ?? 'hash-a',
    },
    oneLine: resolveOneLineSettings({ detailLevel: 'detail', seed: 42 }),
    path: { coords, bounds: { width: 100, height: 75 }, meta: { generatorId: 'importance-stipple-tour', generatorVersion: '1.0.0', seed: 42, sourceImageId: `img-${id}` } },
    render: { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color', lineWidth: 1.5 },
    animation: { durationMs: 15_000, fps: 30, pacing: 'constant-speed', easing: 'linear' },
  });
}

const thumb = (): ProjectThumbnail => ({ data: new Blob([bytes(100)], { type: 'image/webp' }), mimeType: 'image/webp', width: 512, height: 384 });
const blobBytes = async (b: { slice(): { arrayBuffer(): Promise<ArrayBuffer> } }) => new Uint8Array(await b.slice().arrayBuffer());

describe('project repository', () => {
  it('saves and loads everything: settings, path, versions, metadata, original, thumbnail', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const p = project('a', { name: 'Oma' });
    await repo.save(p, thumb());
    const { project: loaded, thumbnail, outdated } = await repo.load('a');
    expect(loaded.oneLine).toEqual(p.oneLine);
    expect(loaded.render).toEqual(p.render);
    // Stored without the phase 12.3 choices: they come back as defaults (speed 1, forward, path start).
    expect(loaded.animation).toEqual({ ...p.animation, speed: 1, direction: 'forward', startPoint: null });
    expect(loaded.versions).toEqual(CURRENT_VERSIONS);
    expect(loaded.image).toMatchObject({ id: 'img-a', fileName: 'foto.jpg', contentHash: 'hash-a', metadata: p.image.metadata });
    expect(await blobBytes(loaded.image.source)).toEqual(bytes(64));
    expect([...loaded.path.coords]).toEqual([...p.path.coords]);
    expect(loaded.path.bounds).toEqual(p.path.bounds);
    expect(loaded.path.meta).toEqual(p.path.meta);
    expect(loaded.path.coords).not.toBe(p.path.coords);
    expect(loaded).toMatchObject({ id: 'a', name: 'Oma', createdAt: p.createdAt, updatedAt: p.updatedAt, schemaVersion: 1 });
    expect(thumbnail).toMatchObject({ mimeType: 'image/webp', width: 512, height: 384 });
    expect(await blobBytes(thumbnail!.data)).toEqual(bytes(100));
    expect(outdated).toEqual([]);
  });

  it('survives a restart (new repository on the same storage)', async () => {
    const backend = createMemoryStorageBackend();
    await createProjectRepository(backend).save(project('a'), thumb());
    const restarted = createProjectRepository(backend);
    expect((await restarted.list()).map((s) => s.id)).toEqual(['a']);
    expect((await restarted.load('a')).project.path.coords.length).toBe(8);
  });

  it('never mutates the project or its original', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const p = project('a');
    const coords = p.path.coords.slice();
    const json = JSON.stringify({ ...p, path: null, image: { ...p.image, source: null } });
    await repo.save(p, null);
    const loaded = (await repo.load('a')).project;
    (loaded.path.coords as Float32Array)[0] = 999;
    expect([...p.path.coords]).toEqual([...coords]);
    expect(JSON.stringify({ ...p, path: null, image: { ...p.image, source: null } })).toBe(json);
    expect([...(await repo.load('a')).project.path.coords]).toEqual([...coords]);
    expect(await blobBytes(p.image.source)).toEqual(bytes(64));
  });

  it('updates in place and lists newest first with gallery data', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    await repo.save(project('a', { updated: '2026-09-01T10:00:00Z' }), thumb());
    await repo.save(project('b', { updated: '2026-09-02T10:00:00Z' }), null);
    await repo.save({ ...project('a', { updated: '2026-09-03T10:00:00Z' }), name: 'neu' }, thumb());
    const list = await repo.list();
    expect(list.map((s) => s.id)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ status: 'ok', name: 'neu', detailLevel: 'detail', colorMode: 'sampled-color', imageSize: { width: 4000, height: 3000 }, pointCount: 4 });
    expect(list[0]!.thumbnail?.width).toBe(512);
    expect(list[1]!.thumbnail).toBeNull();
  });

  it('stores each distinct original once and deletes it with its last project', async () => {
    const backend = createMemoryStorageBackend();
    const repo = createProjectRepository(backend);
    await repo.save(project('a', { hash: 'same' }), thumb());
    await repo.save(project('b', { hash: 'same' }), thumb());
    await repo.save(project('c', { hash: 'other' }), null);
    expect([...backend.stores.get('images')!.keys()].sort()).toEqual(['other', 'same']);
    await repo.remove('a');
    expect(backend.stores.get('images')!.has('same')).toBe(true);
    await repo.remove('b');
    expect(backend.stores.get('images')!.has('same')).toBe(false);
    for (const store of ['projects', 'paths', 'thumbnails'] as const) expect(backend.stores.get(store)!.has('b')).toBe(false);
    expect((await repo.list()).map((s) => s.id)).toEqual(['c']);
    await expect(repo.load('b')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('renames with a new change date', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend(), { now: () => new Date('2026-10-01T00:00:00Z') });
    await repo.save(project('a'), null);
    await repo.rename('a', '  Mein Bild  ');
    expect((await repo.load('a')).project).toMatchObject({ name: 'Mein Bild', updatedAt: '2026-10-01T00:00:00.000Z' });
    await expect(repo.rename('a', 'x'.repeat(STORAGE_LIMITS.maxNameLength + 1))).rejects.toMatchObject({ code: 'invalid-project' });
    await expect(repo.rename('zzz', 'x')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects projects that cannot be stored', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const p = project('a');
    const bad = (patch: Partial<ArtworkProject>) => repo.save({ ...p, ...patch }, null);
    await expect(bad({ path: { ...p.path, coords: new Float32Array([1, 2]) } })).rejects.toMatchObject({ code: 'invalid-project' });
    await expect(bad({ path: { ...p.path, coords: new Float32Array([1, 2, Number.NaN, 4]) } })).rejects.toMatchObject({ code: 'invalid-project' });
    await expect(bad({ path: { ...p.path, meta: { ...p.path.meta, sourceImageId: 'other' } } })).rejects.toMatchObject({ code: 'invalid-project' });
    await expect(bad({ path: null as never })).rejects.toMatchObject({ code: 'invalid-project' });
    await expect(repo.save(p, { ...thumb(), data: new Blob([new Uint8Array(STORAGE_LIMITS.maxThumbnailBytes + 1)]) })).rejects.toMatchObject({ code: 'invalid-project' });
    expect(await repo.list()).toEqual([]);
  });

  it('writes a project atomically: a failing storage keeps the old state', async () => {
    const backend = createMemoryStorageBackend();
    const repo = createProjectRepository({ ...backend, commit: async () => Promise.reject(new StorageError('quota-exceeded')) });
    await expect(repo.save(project('a'), thumb())).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect(await createProjectRepository(backend).list()).toEqual([]);
  });
});

describe('damaged and incompatible data', () => {
  async function stored() {
    const backend = createMemoryStorageBackend();
    const repo = createProjectRepository(backend);
    await repo.save(project('a'), thumb());
    const record = backend.stores.get('projects')!.get('a') as Record<string, unknown>;
    return { backend, repo, record };
  }

  it('projects saved before drawing styles open as Organic presets with their key unchanged', async () => {
    const { backend, repo, record } = await stored();
    const oneLine = record.oneLine as { drawing: Record<string, unknown>; key: string };
    const legacyDrawing = Object.fromEntries(Object.entries(oneLine.drawing).filter(([k]) => !['style', 'detail', 'smoothing'].includes(k)));
    backend.stores.get('projects')!.set('a', { ...record, oneLine: { ...oneLine, drawing: legacyDrawing } });
    const { project: loaded } = await repo.load('a');
    expect(loaded.oneLine.drawing).toMatchObject({ style: 'organic', detail: null, smoothing: null, detailLevel: 'detail' });
    expect(loaded.oneLine.key).toBe(oneLine.key);
    expect((await repo.list())[0]).toMatchObject({ status: 'ok', style: 'organic', custom: false, detailLevel: 'detail' });
  });

  it('stores style and custom detail and shows them in the gallery data', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const p = { ...project('g'), oneLine: resolveOneLineSettings({ style: 'geometric', detail: 0.7, seed: 42 }) };
    await repo.save(p, null);
    expect((await repo.load('g')).project.oneLine).toEqual(p.oneLine);
    expect((await repo.list())[0]).toMatchObject({ style: 'geometric', custom: true });
  });

  it('the image edit is stored and restored; older projects are unedited', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const edit = { rotation: 90 as const, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } };
    await repo.save({ ...project('e'), edit }, null);
    expect((await repo.load('e')).project.edit).toEqual(edit);

    const { backend, repo: repo2, record } = await stored();
    const legacy = Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'edit'));
    backend.stores.get('projects')!.set('a', legacy);
    expect((await repo2.load('a')).project.edit).toEqual(IDENTITY_EDIT);
    expect((await repo2.list())[0]).toMatchObject({ status: 'ok' });
  });

  it('older render settings (before colours) open with defaults', async () => {
    const { backend, repo, record } = await stored();
    const render = Object.fromEntries(Object.entries(record.render as object).filter(([k]) => k !== 'gradient' && k !== 'backgroundBase'));
    backend.stores.get('projects')!.set('a', { ...record, render });
    const loaded = (await repo.load('a')).project.render;
    expect(loaded.gradient).toEqual(DEFAULT_RENDER_SETTINGS.gradient);
    expect(loaded.backgroundBase).toBe('#ffffff');
    expect(loaded.colorMode).toBe('sampled-color');
  });

  it('animation choices are stored; older projects get defaults', async () => {
    const repo = createProjectRepository(createMemoryStorageBackend());
    const animation = { durationMs: 7_500, fps: 30, pacing: 'constant-speed' as const, easing: 'linear' as const, speed: 2, direction: 'reverse' as const, startPoint: { x: 0.25, y: 0.6 } };
    await repo.save({ ...project('m'), animation }, null);
    expect((await repo.load('m')).project.animation).toEqual(animation);

    const { backend, repo: repo2, record } = await stored();
    backend.stores.get('projects')!.set('a', { ...record, animation: { durationMs: 15_000, fps: 30, pacing: 'constant-speed' } });
    expect((await repo2.load('a')).project.animation).toMatchObject({ durationMs: 15_000, speed: 1, direction: 'forward', startPoint: null });
  });

  it('a newer project format is reported as incompatible, never guessed', async () => {
    const { backend, repo, record } = await stored();
    backend.stores.get('projects')!.set('a', { ...record, formatVersion: 99 });
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'incompatible-version' });
    expect((await repo.list())[0]).toMatchObject({ id: 'a', status: 'incompatible' });
  });

  it('broken records are listed as damaged (deletable) and refuse to open', async () => {
    const { backend, repo, record } = await stored();
    const cases: [string, unknown][] = [
      ['not an object', 'garbage'],
      ['no version', { ...record, formatVersion: undefined }],
      ['bad settings', { ...record, render: { ...(record.render as object), lineWidth: Number.NaN } }],
      ['out-of-range settings', { ...record, render: { ...(record.render as object), lineWidth: 1000 } }],
      ['unknown level', { ...record, oneLine: { ...(record.oneLine as object), drawing: { detailLevel: 'ultra' } } }],
      ['bad start point', { ...record, animation: { ...(record.animation as object), startPoint: { x: 'Auge' } } }],
      ['start point outside', { ...record, animation: { ...(record.animation as object), startPoint: { x: 2, y: 0.5 } } }],
      ['bad edit', { ...record, edit: { rotation: 45, crop: { x: 0, y: 0, width: 1, height: 1 } } }],
      ['bad crop', { ...record, edit: { rotation: 0, crop: { x: 'links' } } }],
      ['unknown style', { ...record, oneLine: { ...(record.oneLine as object), drawing: { detailLevel: 'detail', style: 'cubist' } } }],
      ['bad custom detail', { ...record, oneLine: { ...(record.oneLine as object), drawing: { detailLevel: 'detail', detail: 'viel' } } }],
      ['bad date', { ...record, createdAt: 'yesterday' }],
      ['bad path info', { ...record, path: { ...(record.path as object), pointCount: 1 } }],
    ];
    for (const [what, value] of cases) {
      backend.stores.get('projects')!.set('a', value);
      await expect(repo.load('a'), what).rejects.toMatchObject({ code: 'damaged' });
      expect((await repo.list())[0], what).toMatchObject({ id: 'a', status: 'damaged', thumbnail: null });
    }
    await repo.remove('a');
    expect(await repo.list()).toEqual([]);
    expect(backend.stores.get('images')!.size).toBe(0);
  });

  it('missing or inconsistent path / original data is damaged', async () => {
    const { backend, repo } = await stored();
    const paths = backend.stores.get('paths')!;
    const saved = paths.get('a');
    paths.set('a', { coords: new Float32Array([1, 2, 3, 4]) });
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
    paths.set('a', { coords: [1, 2, 3, 4, 5, 6, 7, 8] });
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
    paths.set('a', { coords: new Float32Array([1, 2, 3, 4, 5, 6, 7, Number.POSITIVE_INFINITY]) });
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
    paths.delete('a');
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
    paths.set('a', saved);
    backend.stores.get('images')!.set('hash-a', { contentHash: 'hash-a', data: new Blob([bytes(10)]) });
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
    backend.stores.get('images')!.delete('hash-a');
    await expect(repo.load('a')).rejects.toMatchObject({ code: 'damaged' });
  });

  it('other algorithm versions still open (stored path used as is) and are reported', async () => {
    const { backend, repo, record } = await stored();
    backend.stores.get('projects')!.set('a', { ...record, versions: { ...CURRENT_VERSIONS, engine: '0.9.0' } });
    const loaded = await repo.load('a');
    expect(loaded.outdated).toEqual(['engine']);
    expect(loaded.project.versions.engine).toBe('0.9.0');
    expect(loaded.project.path.coords.length).toBe(8);
  });
});
