import type { AnimationSettings, OneLinePath } from '../models';
import type { RenderSettings } from '../rendering';

/** A finished file ready to hand to the platform (download, share sheet, gallery). */
export interface ExportResult {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** Still image export (SVG/PNG). Implemented in part 8. */
export interface ArtworkExporter {
  readonly format: string;
  export(path: OneLinePath, settings: RenderSettings): Promise<ExportResult>;
}

/** Creation video export, driven by the animation timeline. Implemented in part 8. */
export interface VideoExporter {
  readonly format: string;
  export(path: OneLinePath, settings: RenderSettings, animation: AnimationSettings): Promise<ExportResult>;
}
