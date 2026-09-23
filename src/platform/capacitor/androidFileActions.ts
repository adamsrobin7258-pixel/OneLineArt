import { ExportError, type ExportFile, type ExportFileActions } from '../../core';
import type { MediaExportPlugin } from './mediaExportPlugin';

/**
 * Bytes per bridge message. A multiple of 3, so every chunk is valid base64 on
 * its own; ~2 MB of text per call keeps memory flat even for long 4K videos.
 */
export const TRANSFER_CHUNK_BYTES = 3 * 512 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Writes the blob into the app cache, chunk by chunk (never the whole file as one string). */
async function transfer(plugin: MediaExportPlugin, file: ExportFile<Blob>): Promise<string> {
  const { id } = await plugin.begin({ fileName: file.fileName, mimeType: file.mimeType });
  try {
    for (let offset = 0; offset < file.data.size; offset += TRANSFER_CHUNK_BYTES) {
      const chunk = new Uint8Array(await file.data.slice(offset, offset + TRANSFER_CHUNK_BYTES).arrayBuffer());
      await plugin.append({ id, data: toBase64(chunk) });
    }
    return id;
  } catch (error) {
    await plugin.discard({ id }).catch(() => undefined);
    throw error;
  }
}

const kindOf = (mimeType: string): 'image' | 'video' => (mimeType.startsWith('video/') ? 'video' : 'image');

/**
 * Android: "save" puts the file into the device's photo/video collection,
 * "share" opens the system share sheet. Each export is transferred to the
 * native side once, even if it is saved and shared.
 */
export function createAndroidFileActions(plugin: MediaExportPlugin): ExportFileActions<Blob> {
  const transferred = new WeakMap<Blob, Promise<string>>();
  const nativeId = (file: ExportFile<Blob>) => {
    let id = transferred.get(file.data);
    if (!id) {
      id = transfer(plugin, file);
      transferred.set(file.data, id);
      // A failed transfer may be retried.
      id.catch(() => transferred.delete(file.data));
    }
    return id;
  };

  return {
    saveKind: 'gallery',
    async save(file) {
      try {
        const id = await nativeId(file);
        const { location } = await plugin.saveToGallery({ id, mimeType: file.mimeType, kind: kindOf(file.mimeType) });
        return { location };
      } catch (error) {
        throw new ExportError('save-failed', error instanceof Error ? error.message : String(error), { cause: error });
      }
    },
    canShare: () => true,
    async share(file) {
      try {
        const id = await nativeId(file);
        await plugin.share({ id, mimeType: file.mimeType, title: file.fileName });
        return true;
      } catch (error) {
        throw new ExportError('save-failed', error instanceof Error ? error.message : String(error), { cause: error });
      }
    },
  };
}
