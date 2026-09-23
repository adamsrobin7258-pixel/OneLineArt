import type { BinarySource, ImageFormat, ImageMetadata } from '../models';
import { fitWithin, orientedSize } from '../imageProcessing';
import { createByteHasher } from '../utils';
import { ImageImportError, isOutOfMemoryError } from './errors';
import { detectFormat } from './formatDetection';
import { HEADER_READ_BYTES, readImageHeader } from './imageHeader';
import { DEFAULT_IMPORT_OPTIONS, type ImageImportOptions } from './options';
import type { DecodedImage, ImageDecoder, ImportedImage } from './types';

export type ImportPhase = 'loading' | 'processing';

export interface ImportImageParams<THandle, TPreview> {
  readonly decoder: ImageDecoder<THandle, TPreview>;
  /** Supplies unique ids; the platform decides how (kept out of the deterministic core). */
  readonly createId: () => string;
  readonly options?: ImageImportOptions;
  readonly onPhase?: (phase: ImportPhase) => void;
}

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

async function readBytes(source: BinarySource, start: number, end: number): Promise<Uint8Array> {
  try {
    return new Uint8Array(await source.slice(start, end).arrayBuffer());
  } catch (cause) {
    throw new ImageImportError(isOutOfMemoryError(cause) ? 'out-of-memory' : 'read-failed', undefined, { cause });
  }
}

/** Hashes the file in chunks so the whole original is never held in memory at once. */
async function hashSource(source: BinarySource): Promise<string> {
  const hasher = createByteHasher();
  for (let offset = 0; offset < source.size; offset += HASH_CHUNK_BYTES) {
    hasher.update(await readBytes(source, offset, offset + HASH_CHUNK_BYTES));
  }
  return hasher.digest();
}

const isHeif = (format: ImageFormat): boolean => format === 'heic' || format === 'heif';

/**
 * Import flow: validate → identify → read header → hash → decode once →
 * normalize (preview + processing copy). The original source is never modified.
 */
export async function importImage<THandle, TPreview>(
  source: BinarySource,
  params: ImportImageParams<THandle, TPreview>,
): Promise<ImportedImage<TPreview>> {
  const { decoder, createId, onPhase } = params;
  const options = params.options ?? DEFAULT_IMPORT_OPTIONS;
  onPhase?.('loading');

  if (source.size === 0) throw new ImageImportError('invalid-file', 'File is empty');
  if (source.size > options.maxFileBytes) throw new ImageImportError('file-too-large');

  const head = await readBytes(source, 0, HEADER_READ_BYTES);
  const detected = detectFormat(head);
  if (detected.kind === 'unknown') throw new ImageImportError('invalid-file');
  if (detected.kind === 'unsupported') throw new ImageImportError('unsupported-format', detected.name);
  const { format, mimeType } = detected;

  const header = readImageHeader(head, format);
  if (header.rawSize && header.rawSize.width * header.rawSize.height > options.maxPixels) {
    throw new ImageImportError('dimensions-too-large');
  }

  const contentHash = await hashSource(source);

  let decoded: DecodedImage<THandle>;
  try {
    decoded = await decoder.decode(source, format);
  } catch (cause) {
    if (cause instanceof ImageImportError) throw cause;
    if (isOutOfMemoryError(cause)) throw new ImageImportError('out-of-memory', undefined, { cause });
    throw new ImageImportError(isHeif(format) ? 'heic-unsupported' : 'corrupt', undefined, { cause });
  }

  if (!(decoded.width > 0 && decoded.height > 0) || decoded.width * decoded.height > options.maxPixels) {
    decoder.discard(decoded);
    throw new ImageImportError(decoded.width > 0 ? 'dimensions-too-large' : 'corrupt');
  }

  onPhase?.('processing');
  const size = { width: decoded.width, height: decoded.height };
  const processingSize = fitWithin(size, options.processingMaxEdge);
  let normalized: Awaited<ReturnType<typeof decoder.normalize>>;
  try {
    normalized = await decoder.normalize(decoded, { preview: fitWithin(size, options.previewMaxEdge), processing: processingSize });
  } catch (cause) {
    if (cause instanceof ImageImportError) throw cause;
    throw new ImageImportError(isOutOfMemoryError(cause) ? 'out-of-memory' : 'corrupt', undefined, { cause });
  }

  // Prefer the header's orientation when it predicts the decoded size; otherwise
  // the decoder had better information (e.g. HEIC container orientation).
  const orientation =
    header.rawSize && orientedSize(header.rawSize, header.orientation).width === size.width ? header.orientation : 1;

  const id = createId();
  const metadata: ImageMetadata = {
    format,
    mimeType,
    fileSizeBytes: source.size,
    width: size.width,
    height: size.height,
    aspectRatio: size.width / size.height,
    orientation,
  };
  return {
    original: { id, fileName: source.name || 'Bild', source, metadata, contentHash },
    processed: { sourceImageId: id, pixels: normalized.pixels, scale: processingSize.width / size.width },
    preview: normalized.preview,
  };
}
