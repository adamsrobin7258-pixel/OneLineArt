import { DEFAULT_RENDER_SETTINGS, resolveOneLineSettings, type OneLinePath, type ProcessedImage } from '../../core';
import { compareRendering, type RenderingComparison, type VariableWidthLine } from '../../core/experimental/variableWidth';
import { runAnalysis } from '../../platform/browser/analysisRunner';
import { renderArtworkSurface, freeSurface } from '../../platform/browser/artworkRenderer';
import { runPathGeneration } from '../../platform/browser/pathRunner';
import { canvasOf, drawLine, lightnessOfCanvas, lightnessOfImage, sizeFor } from './draw';

/** Long edge at which both drawings are measured (the app's reference render edge). */
export const MEASURE_EDGE = 1000;

export interface OrganicResult {
  readonly path: OneLinePath;
  readonly durationMs: number;
}

/**
 * The existing Organic style, exactly as the app computes it (analysis worker,
 * path worker, Balanced preset, seed 1) — unchanged, only called from here.
 */
export async function runOrganic(processed: ProcessedImage): Promise<OrganicResult> {
  const started = performance.now();
  const { analysis } = await runAnalysis(processed).promise;
  const e = resolveOneLineSettings({ style: 'organic', detailLevel: 'balanced', seed: 1 });
  const outcome = await runPathGeneration(processed, analysis, e.settings, e.parameters, e.engineId).promise;
  return { path: outcome.path, durationMs: performance.now() - started };
}

/** Draws the organic path with the app's own renderer (default render settings: black, 1 px @ 1000 px). */
export function drawOrganic(ctx: CanvasRenderingContext2D, path: OneLinePath, longEdge: number): void {
  const { surface, size } = renderArtworkSurface({ path, settings: DEFAULT_RENDER_SETTINGS, longEdge });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(surface.canvas as CanvasImageSource, 0, 0, size.width, size.height);
  freeSurface(surface);
}

export interface Comparison {
  readonly prototype: RenderingComparison;
  readonly organic: RenderingComparison | null;
}

/** Both drawings at MEASURE_EDGE, compared with the original at the prototype's line spacing. */
export function measure(processed: ProcessedImage, line: VariableWidthLine, organic: OneLinePath | null): Comparison {
  const size = sizeFor(line.path.bounds, MEASURE_EDGE);
  const original = lightnessOfImage(processed.pixels, size);
  const spacingPx = line.spacing * (size.width / line.path.bounds.width);
  const a = canvasOf(size);
  drawLine(a.ctx, line, size);
  const prototype = compareRendering(original, lightnessOfCanvas(a.ctx, size), spacingPx);
  let other: RenderingComparison | null = null;
  if (organic) {
    const b = canvasOf(size);
    b.ctx.fillStyle = '#ffffff';
    b.ctx.fillRect(0, 0, size.width, size.height);
    drawOrganic(b.ctx, organic, MEASURE_EDGE);
    other = compareRendering(original, lightnessOfCanvas(b.ctx, size), spacingPx);
  }
  return { prototype, organic: other };
}
