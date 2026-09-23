import {
  describeArtwork,
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
} from '../../core';

type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: RenderContext2D };

function createSurface(width: number, height: number): Surface {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: true }) as unknown as RenderContext2D | null;
  if (!ctx) throw new Error('Canvas allocation failed');
  return { canvas, ctx };
}

function free(surface: Surface): void {
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}

const colorCache = new WeakMap<OneLinePath, Map<string, LineColors>>();

/**
 * Sampled line colours for a path, cached per path and sampling settings:
 * switching black ↔ colour or changing the background re-draws only.
 */
export function lineColorsFor(path: OneLinePath, image: RasterImage, settings: RenderSettings): LineColors {
  const dark = isDarkBackground(settings);
  const key = `${JSON.stringify(settings.sampling)}|${dark}`;
  let perPath = colorCache.get(path);
  if (!perPath) colorCache.set(path, (perPath = new Map()));
  let colors = perPath.get(key);
  if (!colors) perPath.set(key, (colors = sampleLineColors(path, image, settings.sampling, dark)));
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
}

/**
 * Renders the already computed OneLinePath into a NEW bitmap. Never runs the
 * engine, never touches the original image. Opacity is applied once to the
 * whole line via a separate line layer (no double-darkened run boundaries).
 */
export async function renderArtwork(request: RenderArtworkRequest): Promise<RasterArtwork<ImageBitmap>> {
  const started = performance.now();
  const { path, settings } = request;
  const size = renderSize(path.bounds, request.longEdge);
  const lineColors = settings.colorMode === 'sampled-color' ? lineColorsFor(path, request.image!, settings) : null;
  const plan = planArtwork({ path, settings, width: size.width, height: size.height, lineColors });

  const base = createSurface(size.width, size.height);
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
    free(layer);
  }

  const image = base.canvas instanceof OffscreenCanvas ? base.canvas.transferToImageBitmap() : await createImageBitmap(base.canvas);
  free(base);
  return {
    format: 'raster',
    size,
    image,
    settings,
    metrics: { ...describeArtwork(plan, path, lineColors), renderRuntimeMs: performance.now() - started },
  };
}
