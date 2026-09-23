import type { RenderMetrics, RenderSettings } from '../rendering';
import type { Size } from './geometry';

export interface RenderStyle {
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly backgroundColor: string | null;
}

export const DEFAULT_RENDER_STYLE: RenderStyle = {
  strokeColor: '#111111',
  strokeWidth: 1.25,
  backgroundColor: '#ffffff',
};

/** Simple vector style for the SVG output (monochrome). */
export type SvgArtwork = { readonly format: 'svg'; readonly data: string; readonly size: Size };

/**
 * A rendered raster artwork. Always a NEW image — the original is never
 * modified. `image` is a platform handle (e.g. an ImageBitmap in the browser).
 */
export interface RasterArtwork<TImage = unknown> {
  readonly format: 'raster';
  readonly size: Size;
  readonly image: TImage;
  readonly settings: RenderSettings;
  readonly metrics: RenderMetrics & { readonly renderRuntimeMs: number };
}

/** Output of the rendering stage. */
export type RenderedArtwork<TImage = unknown> = SvgArtwork | RasterArtwork<TImage>;
