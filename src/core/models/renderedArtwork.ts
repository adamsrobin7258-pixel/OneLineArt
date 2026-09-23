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

/** Output of the rendering stage. More formats (PNG) follow in parts 6/8. */
export type RenderedArtwork = { readonly format: 'svg'; readonly data: string; readonly size: Size };
