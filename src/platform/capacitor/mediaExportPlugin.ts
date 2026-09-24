import { registerPlugin } from '@capacitor/core';

/**
 * Small native plugin of this app (android/app/src/main/java/.../MediaExportPlugin.java).
 * Files are streamed in base64 chunks into the app cache; from there they are
 * copied into the shared media collection (MediaStore) or shared via FileProvider.
 */
export interface MediaExportPlugin {
  /** Starts a new file in the app cache. */
  begin(options: { fileName: string; mimeType: string }): Promise<{ id: string }>;
  /** Appends one base64-encoded chunk. */
  append(options: { id: string; data: string }): Promise<void>;
  /** Copies the file into Pictures/One Line Art or Movies/One Line Art (MediaStore). */
  saveToGallery(options: { id: string; mimeType: string; kind: 'image' | 'video' }): Promise<{ uri: string; location: string }>;
  /**
   * Opens the system "save as" dialog (place and name chosen by the user, `fileName` suggested)
   * and copies the cached file there. `saved: false` = the dialog was closed without saving.
   */
  saveAs(options: { id: string; mimeType: string; fileName: string }): Promise<{ saved: boolean; uri?: string }>;
  /** Opens the Android share sheet for the file. */
  share(options: { id: string; mimeType: string; title: string }): Promise<void>;
  /** Removes the cached file. */
  discard(options: { id: string }): Promise<void>;
}

export const MediaExport = registerPlugin<MediaExportPlugin>('MediaExport');
