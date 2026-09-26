import { DEFAULT_RENDER_SETTINGS, resolveOneLineSettings, type OneLinePath, type ProcessedImage, type Size } from '../../core';
import { compareRendering, measureLineGeometry, type LineGeometry, type RenderingComparison, type VariableWidthLine } from '../../core/experimental/variableWidth';
import { runAnalysis } from '../../platform/browser/analysisRunner';
import { renderArtworkSurface, freeSurface } from '../../platform/browser/artworkRenderer';
import { runPathGeneration } from '../../platform/browser/pathRunner';
import { FULL_VIEW, applyView, canvasOf, drawLine, lightnessOfCanvas, lightnessOfImage, sizeFor, type ViewWindow } from './draw';

/** Long edge at which all drawings are measured (the app's reference render edge). */
export const MEASURE_EDGE = 1000;
/** Largest canvas edge used for a magnified organic rendering. */
const MAX_ZOOM_EDGE = 4096;

export interface OrganicResult {
  readonly path: OneLinePath;
  readonly durationMs: number;
}

/** Production styles shown for comparison. */
export type ProductionStyle = 'organic' | 'orthogonal';

/**
 * An existing production style, exactly as the app computes it (analysis
 * worker, path worker, Balanced preset, seed 1) — unchanged, only called from here.
 */
export async function runProduction(processed: ProcessedImage, style: ProductionStyle): Promise<OrganicResult> {
  const started = performance.now();
  const { analysis } = await runAnalysis(processed).promise;
  const e = resolveOneLineSettings({ style, detailLevel: 'balanced', seed: 1 });
  const outcome = await runPathGeneration(processed, analysis, e.settings, e.parameters, e.engineId).promise;
  return { path: outcome.path, durationMs: performance.now() - started };
}

/**
 * Draws a production path (Organic or Orthogonal) with the app's own renderer (default render settings:
 * black, 1 px @ 1000 px) into a canvas of `size`, optionally magnified.
 */
export function drawOrganic(ctx: CanvasRenderingContext2D, path: OneLinePath, size: Size, view: ViewWindow = FULL_VIEW): void {
  const longEdge = Math.min(MAX_ZOOM_EDGE, Math.max(size.width, size.height) * Math.max(1, view.zoom));
  const { surface } = renderArtworkSurface({ path, settings: DEFAULT_RENDER_SETTINGS, longEdge });
  applyView(ctx, size, view);
  ctx.drawImage(surface.canvas as CanvasImageSource, 0, 0, size.width, size.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  freeSurface(surface);
}

export interface VariantMeasurement {
  readonly geometry: LineGeometry | null;
  readonly tone: RenderingComparison;
  readonly durationMs: number | null;
}

/**
 * Every drawing at MEASURE_EDGE, compared with the original at the line
 * spacing; plus the spacing/width statistics of each variable-width line.
 */
export function measureVariants(
  processed: ProcessedImage,
  lines: ReadonlyArray<{ readonly key: string; readonly line: VariableWidthLine; readonly durationMs: number }>,
  production: ReadonlyMap<string, OneLinePath>,
): Map<string, VariantMeasurement> {
  const out = new Map<string, VariantMeasurement>();
  const first = lines[0]?.line;
  if (!first) return out;
  const size = sizeFor(first.path.bounds, MEASURE_EDGE);
  const original = lightnessOfImage(processed.pixels, size);
  const spacingPx = first.spacing * (size.width / first.path.bounds.width);
  for (const { key, line, durationMs } of lines) {
    const a = canvasOf(size);
    drawLine(a.ctx, line, size);
    out.set(key, { geometry: measureLineGeometry(line), tone: compareRendering(original, lightnessOfCanvas(a.ctx, size), spacingPx), durationMs });
  }
  for (const [key, path] of production) {
    const b = canvasOf(size);
    b.ctx.fillStyle = '#ffffff';
    b.ctx.fillRect(0, 0, size.width, size.height);
    drawOrganic(b.ctx, path, size);
    out.set(key, { geometry: null, tone: compareRendering(original, lightnessOfCanvas(b.ctx, size), spacingPx), durationMs: null });
  }
  return out;
}
