import { describe, expect, it } from 'vitest';
import { MAX_SCALE, clampView, containSize, fitView, panBy, wheelZoomFactor, zoomAt } from '../../src/ui/viewport/viewTransform';

const container = { width: 1000, height: 800 };

describe('preview viewport (zoom/pan)', () => {
  it.each([
    ['1:1', 3000, 3000],
    ['4:3', 4000, 3000],
    ['3:4', 3000, 4000],
    ['16:9', 1920, 1080],
    ['9:16', 1080, 1920],
  ])('fits a %s image without distortion', (_, width, height) => {
    const fit = containSize({ width, height }, container);
    expect(fit.width / fit.height).toBeCloseTo(width / height, 10);
    expect(fit.width <= container.width + 1e-9 && fit.height <= container.height + 1e-9).toBe(true);
    expect(Math.abs(fit.width - container.width) < 1e-9 || Math.abs(fit.height - container.height) < 1e-9).toBe(true);
  });

  it('centers the fitted image', () => {
    const view = fitView({ width: 1000, height: 1000 }, container);
    expect(view).toEqual({ scale: 1, x: 100, y: 0 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const image = { width: 2000, height: 1600 };
    const start = fitView(image, container);
    const anchor = { x: 300, y: 200 };
    const zoomed = zoomAt(start, 2, anchor, image, container);
    const imagePoint = (v: typeof start) => ({ u: (anchor.x - v.x) / v.scale, v: (anchor.y - v.y) / v.scale });
    expect(zoomed.scale).toBe(2);
    expect(imagePoint(zoomed).u).toBeCloseTo(imagePoint(start).u);
    expect(imagePoint(zoomed).v).toBeCloseTo(imagePoint(start).v);
  });

  it('limits zoom to [fit, MAX_SCALE]', () => {
    const image = { width: 2000, height: 1600 };
    const view = fitView(image, container);
    expect(zoomAt(view, 0.1, { x: 0, y: 0 }, image, container).scale).toBe(1);
    expect(zoomAt(view, 1000, { x: 0, y: 0 }, image, container).scale).toBe(MAX_SCALE);
  });

  it('does not let the image be dragged out of view', () => {
    const image = { width: 2000, height: 1600 };
    const zoomed = zoomAt(fitView(image, container), 2, { x: 500, y: 400 }, image, container);
    const panned = panBy(zoomed, 10_000, 10_000, image, container);
    expect(panned.x).toBe(0);
    expect(panned.y).toBe(0);
    const other = panBy(zoomed, -10_000, -10_000, image, container);
    expect(other.x).toBe(container.width - 2000);
    expect(other.y).toBe(container.height - 1600);
  });

  it('cannot pan at fit scale', () => {
    const image = { width: 1000, height: 1000 };
    expect(panBy(fitView(image, container), 50, 50, image, container)).toEqual(fitView(image, container));
  });

  it('re-clamps after a container resize (e.g. rotation)', () => {
    const image = { width: 1000, height: 1000 };
    const view = clampView({ scale: 1, x: 0, y: 0 }, image, { width: 400, height: 900 });
    expect(view).toEqual({ scale: 1, x: 0, y: 250 });
  });

  it('maps wheel deltas to zoom factors (in/out, pinch more sensitive)', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(-10, 0, true)).toBeGreaterThan(wheelZoomFactor(-10, 0, false));
    expect(wheelZoomFactor(-3, 1, false)).toBeCloseTo(wheelZoomFactor(-48, 0, false));
  });
});
