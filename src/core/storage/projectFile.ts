import { resolveOneLineSettings, type EffectiveOneLineSettings } from '../drawing';
import { sanitizeEngineParameters } from '../engine';
import type { ArtworkProject } from '../models';
import { createByteHasher, decodeUtf8, encodeUtf8 } from '../utils';
import { parsePathRecord, parseProjectRecord, toProjectRecord, type ProjectRecord } from './projectRecord';
import { STORAGE_LIMITS, StorageError, type ProjectThumbnail } from './types';

/**
 * Portable project file ".onelineart" (phase 13.6) — an exchange format next
 * to the internal storage, which it does not replace.
 *
 *   bytes 0–9    "ONELINEART" (ASCII)
 *   byte  10     file format version (PROJECT_FILE_VERSION)
 *   byte  11     reserved (0)
 *   bytes 12–15  manifest length (uint32, little endian)
 *   manifest     UTF-8 JSON: { kind, formatVersion, project, sections }
 *   then, in this order and exactly as long as the manifest says:
 *     original image (the untouched file, once), path (float32 x/y, little
 *     endian), thumbnail (optional)
 *
 * `project` has the shape of the stored project record, so importing runs it
 * through the SAME strict validation as loading from storage. Nothing unknown
 * is taken over; ids are replaced on import.
 */
export const PROJECT_FILE_EXTENSION = 'onelineart';
export const PROJECT_FILE_MIME_TYPE = 'application/octet-stream';
export const PROJECT_FILE_VERSION = 1;
const MAGIC = 'ONELINEART';
const HEADER_BYTES = 16;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const KIND = 'onelineart-project';

/** Largest file that can be valid: manifest + original + path + thumbnail (checked before parsing). */
export const MAX_PROJECT_FILE_BYTES = HEADER_BYTES + MAX_MANIFEST_BYTES + STORAGE_LIMITS.maxImageBytes + STORAGE_LIMITS.maxPathPoints * 8 + STORAGE_LIMITS.maxThumbnailBytes;

interface Section {
  readonly length: number;
}
interface Manifest {
  readonly kind: typeof KIND;
  readonly formatVersion: number;
  readonly project: ProjectRecord;
  readonly sections: {
    readonly image: Section & { readonly mimeType: string };
    readonly path: Section;
    readonly thumbnail: (Section & { readonly mimeType: string; readonly width: number; readonly height: number }) | null;
  };
}

/** A checked project file: every part validated, ready to be stored under new ids. */
export interface ProjectFileContents {
  /** Validated settings and metadata (its id, image id and favourite are placeholders). */
  readonly record: ProjectRecord;
  readonly image: { readonly bytes: Uint8Array; readonly mimeType: string };
  readonly coords: Float32Array;
  readonly thumbnail: { readonly bytes: Uint8Array; readonly mimeType: string; readonly width: number; readonly height: number } | null;
}

const invalidFile = (what: string) => new StorageError('damaged', `Project file: ${what}`);

/** Writes a project (with its original image, path and thumbnail) into one portable file. */
export async function encodeProjectFile(project: ArtworkProject, thumbnail: ProjectThumbnail | null): Promise<Uint8Array<ArrayBuffer>> {
  const image = new Uint8Array(await project.image.source.slice(0, project.image.source.size).arrayBuffer());
  const coords = project.path.coords;
  const path = new Uint8Array(coords.length * 4);
  const view = new DataView(path.buffer);
  for (let i = 0; i < coords.length; i++) view.setFloat32(i * 4, coords[i]!, true);
  const thumb = thumbnail ? new Uint8Array(await thumbnail.data.slice(0, thumbnail.data.size).arrayBuffer()) : null;

  // The favourite marker belongs to the own gallery and is not part of the file.
  const record = toProjectRecord(project, thumbnail, false);
  const manifest: Manifest = {
    kind: KIND,
    formatVersion: PROJECT_FILE_VERSION,
    project: record,
    sections: {
      image: { length: image.length, mimeType: project.image.metadata.mimeType },
      path: { length: path.length },
      thumbnail: thumb && thumbnail ? { length: thumb.length, mimeType: thumbnail.mimeType, width: thumbnail.width, height: thumbnail.height } : null,
    },
  };
  const json = encodeUtf8(JSON.stringify(manifest));
  const out = new Uint8Array(HEADER_BYTES + json.length + image.length + path.length + (thumb?.length ?? 0));
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  out[10] = PROJECT_FILE_VERSION;
  new DataView(out.buffer).setUint32(12, json.length, true);
  let offset = HEADER_BYTES;
  for (const part of [json, image, path, thumb]) {
    if (!part) continue;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLength = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Reads and checks a project file. Rejects anything that is not exactly a
 * valid file of a known version: StorageError 'incompatible-version' for newer
 * formats, 'damaged' for everything else (wrong type, truncated, altered,
 * invalid settings). Never throws anything else.
 */
export function decodeProjectFile(bytes: Uint8Array): ProjectFileContents {
  try {
    return decode(bytes);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('damaged', 'Project file: unreadable', { cause: error });
  }
}

function decode(bytes: Uint8Array): ProjectFileContents {
  if (bytes.length < HEADER_BYTES) throw invalidFile('too short');
  if (bytes.length > MAX_PROJECT_FILE_BYTES) throw invalidFile('too large');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw invalidFile('not a One Line project file');
  const version = bytes[10]!;
  if (version > PROJECT_FILE_VERSION) throw new StorageError('incompatible-version', `Project file version ${version} is newer than ${PROJECT_FILE_VERSION}`);
  if (version < 1 || bytes[11] !== 0) throw invalidFile(`unknown version ${version}`);
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  if (manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > bytes.length) throw invalidFile('manifest length');
  let manifest: unknown;
  try {
    manifest = JSON.parse(decodeUtf8(bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength)));
  } catch {
    throw invalidFile('manifest is not readable');
  }
  if (!isObject(manifest) || manifest.kind !== KIND || manifest.formatVersion !== version) throw invalidFile('manifest');
  const sections = manifest.sections;
  if (!isObject(sections) || !isObject(sections.image) || !isObject(sections.path)) throw invalidFile('sections');
  const image = sections.image, path = sections.path;
  const thumb = sections.thumbnail === null ? null : isObject(sections.thumbnail) ? sections.thumbnail : undefined;
  if (thumb === undefined) throw invalidFile('thumbnail section');
  if (!isLength(image.length) || typeof image.mimeType !== 'string' || !isLength(path.length)) throw invalidFile('section sizes');
  if (thumb && (!isLength(thumb.length) || thumb.length > STORAGE_LIMITS.maxThumbnailBytes || typeof thumb.mimeType !== 'string' || !thumb.mimeType.startsWith('image/') || !isLength(thumb.width) || !isLength(thumb.height) || thumb.width < 1 || thumb.height < 1)) {
    throw invalidFile('thumbnail');
  }
  // The parts fill the file exactly: nothing missing, nothing appended.
  const start = HEADER_BYTES + manifestLength;
  if (start + image.length + path.length + ((thumb?.length as number | undefined) ?? 0) !== bytes.length) throw invalidFile('size does not match its contents');

  // The same strict checks as a stored project; ids are placeholders (new ones on import).
  if (!isObject(manifest.project)) throw invalidFile('project');
  const parsed = parseProjectRecord({ ...manifest.project, id: 'import', favorite: false });
  const record: ProjectRecord = { ...parsed, oneLine: checkedOneLine(parsed.oneLine) };

  const imageBytes = bytes.slice(start, start + image.length);
  if (image.mimeType !== record.image.metadata.mimeType || imageBytes.length !== record.image.metadata.fileSizeBytes) throw invalidFile('original image');
  const hasher = createByteHasher();
  hasher.update(imageBytes);
  if (hasher.digest() !== record.image.contentHash) throw invalidFile('original image was altered');
  if (imageBytes.length > STORAGE_LIMITS.maxImageBytes) throw invalidFile('original image too large');

  if (path.length !== record.path.pointCount * 8) throw invalidFile('path size');
  const view = new DataView(bytes.buffer, bytes.byteOffset + start + image.length, path.length);
  const coords = new Float32Array(record.path.pointCount * 2);
  for (let i = 0; i < coords.length; i++) coords[i] = view.getFloat32(i * 4, true);
  // Finite, right length, belongs to this image: the storage's own path checks.
  parsePathRecord({ coords }, record);

  const thumbStart = start + image.length + path.length;
  return {
    record,
    image: { bytes: imageBytes, mimeType: image.mimeType },
    coords,
    thumbnail: thumb
      ? { bytes: bytes.slice(thumbStart, thumbStart + (thumb.length as number)), mimeType: thumb.mimeType as string, width: thumb.width as number, height: thumb.height as number }
      : null,
  };
}

/**
 * The drawing settings of a file come from outside: re-derived from the
 * drawing choices when they match this app (identical key), otherwise the
 * stored engine parameters must pass the engine's safety limits unchanged.
 */
function checkedOneLine(stored: EffectiveOneLineSettings): EffectiveOneLineSettings {
  let fresh: EffectiveOneLineSettings;
  try {
    fresh = resolveOneLineSettings(stored.drawing);
  } catch {
    throw invalidFile('drawing settings');
  }
  if (fresh.key === stored.key) return fresh;
  let check;
  try {
    check = sanitizeEngineParameters(stored.parameters);
  } catch {
    throw invalidFile('engine parameters');
  }
  if (check.issues.length > 0) throw invalidFile('engine parameters');
  return stored;
}

/** Name for an imported work: unchanged when free, else "<Name> – Import", "<Name> – Import 2", … (within the name limit). */
export function importedName(name: string, taken: readonly string[]): string {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  const used = new Set(taken.map((n) => n.trim().toLocaleLowerCase('de')));
  if (!used.has(trimmed.toLocaleLowerCase('de'))) return trimmed;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' – Import' : ` – Import ${n}`;
    const candidate = `${Array.from(trimmed).slice(0, STORAGE_LIMITS.maxNameLength - suffix.length).join('').trimEnd()}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase('de'))) return candidate;
  }
}
