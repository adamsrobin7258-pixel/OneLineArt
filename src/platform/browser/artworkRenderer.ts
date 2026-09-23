import {
  describeArtwork,
  gradientLineColors,
  usesLineColors,
  drawArtworkBackground,
  drawArtworkLine,
  isDarkBackground,
  planArtwork,
  renderSize,
  sampleLineColors,
  type LineColors,
  type OneLinePath,
  type RasterArtwork,
  type RasterImage,
  type RenderContext2D,
  type RenderSettings,
  type Size,
} from '../../core';

export type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: RenderContext2D };

export function createSurface(width: number, height: number): Surface {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: true }) as unknown as RenderContext2D | null;
  if (!ctx) throw new Error('Canvas allocation failed');
  return { canvas, ctx };
}

export function freeSurface(surface: Surface): void {
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}

const colorCache = new WeakMap<OneLinePath, Map<string, LineColors>>();

/**
 * Per-vertex line colours for a path (photo colours or a gradient), cached per
 * path and colour settings: switching modes, palettes or the background
 * re-draws only — the path itself is never recomputed.
 */
export function lineColorsFor(path: OneLinePath, image: RasterImage, settings: RenderSettings): LineColors {
  const dark = isDarkBackground(settings);
  const gradient = settings.colorMode === 'gradient';
  const key = gradient ? `gradient|${settings.gradient.colors.join(',')}|${settings.sampling.strength}` : `${JSON.stringify(settings.sampling)}|${dark}`;
  let perPath = colorCache.get(path);
  if (!perPath) colorCache.set(path, (perPath = new Map()));
  let colors = perPath.get(key);
  if (!colors) {
    colors = gradient ? gradientLineColors(path, settings.gradient.colors, settings.sampling.strength) : sampleLineColors(path, image, settings.sampling, dark);
    perPath.set(key, colors);
  }
  return colors;
}

export interface RenderArtworkRequest {
  readonly path: OneLinePath;
  readonly settings: RenderSettings;
  /** Long edge of the rendering in px (aspect ratio comes from the path). */
  readonly longEdge: number;
  /** Working image for colour sampling ('sampled-color'). */
  readonly image?: RasterImage | null;
  /** Photo for background 'original'. */
  readonly backgroundImage?: CanvasImageSource | null;
  /** Already sampled colours of this path (e.g. computed on the main thread for a worker). */
  readonly lineColors?: LineColors | null;
}

/** A finished rendering on a surface (caller owns it and must free it). */
export interface RenderedSurface {
  readonly surface: Surface;
  readonly size: Size;
  readonly metrics: RasterArtwork['metrics'];
}

/**
 * Renders the already computed OneLinePath onto a NEW surface. Never runs the
 * engine, never touches the original image. Opacity is applied once to the
 * whole line via a separate line layer (no double-darkened run boundaries).
 * Shared by the preview, thumbnails and image export.
 */
export function renderArtworkSurface(request: RenderArtworkRequest): RenderedSurface {
  const started = performance.now();
  const { path, settings } = request;
  const size = renderSize(path.bounds, request.longEdge);
  const lineColors = usesLineColors(settings) ? (request.lineColors ?? lineColorsFor(path, request.image!, settings)) : null;
  const plan = planArtwork({ path, settings, width: size.width, height: size.height, lineColors });

  const base = createSurface(size.width, size.height);
  try {
    drawArtworkBackground(plan, base.ctx, request.backgroundImage ?? undefined);
    if (plan.lineOpacity >= 1) {
      drawArtworkLine(plan, path, base.ctx);
    } else if (plan.lineOpacity > 0) {
      const layer = createSurface(size.width, size.height);
      drawArtworkLine(plan, path, layer.ctx);
      base.ctx.setTransform(1, 0, 0, 1, 0, 0);
      base.ctx.globalAlpha = plan.lineOpacity;
      base.ctx.drawImage(layer.canvas as never, 0, 0, size.width, size.height);
      base.ctx.globalAlpha = 1;
      freeSurface(layer);
    }
  } catch (error) {
    freeSurface(base);
    throw error;
  }
  return { surface: base, size, metrics: { ...describeArtwork(plan, path, lineColors), renderRuntimeMs: performance.now() - started } };
}

/** Renders the artwork into a NEW bitmap (preview). */
export async function renderArtwork(request: RenderArtworkRequest): Promise<RasterArtwork<ImageBitmap>> {
  const started = performance.now();
  const { surface, size, metrics } = renderArtworkSurface(request);
  const image = surface.canvas instanceof OffscreenCanvas ? surface.canvas.transferToImageBitmap() : await createImageBitmap(surface.canvas);
  freeSurface(surface);
  return { format: 'raster', size, image, settings: request.settings, metrics: { ...metrics, renderRuntimeMs: performance.now() - started } };
}
