import type { ExportFile } from '../../../core';

/** Delay before releasing the object URL of a download (the browser needs it until the download started). */
const REVOKE_DELAY_MS = 60_000;

/** Saves the file via the browser's download. */
export function downloadFile(file: ExportFile<Blob>): void {
  const url = URL.createObjectURL(file.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

const asFile = (file: ExportFile<Blob>) => new File([file.data], file.fileName, { type: file.mimeType });

/** True if the system share sheet can take this file (Web Share API level 2). */
export function canShareFile(file: ExportFile<Blob>): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [asFile(file)] }) === true;
  } catch {
    return false;
  }
}

/** Opens the share sheet. Resolves false if the user closed it. Must be called from a user gesture. */
export async function shareFile(file: ExportFile<Blob>): Promise<boolean> {
  try {
    await navigator.share({ files: [asFile(file)], title: file.fileName });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}
