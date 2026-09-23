import { describe, expect, it } from 'vitest';
import { cropLayout, frameIn, resizeCrop, toImage } from '../../src/ui/viewport/cropLayout';

const image = { width: 400, height: 300 };
const stage = { width: 800, height: 600 };

describe('crop editor layout', () => {
  it('fits and centres the crop frame; the image lies under it', () => {
    const full = cropLayout({ x: 0, y: 0, width: 1, height: 1 }, image, stage, 20);
    expect(full.frame.width / full.frame.height).toBeCloseTo(4 / 3);
    expect(full.frame.x + full.frame.width / 2).toBeCloseTo(400);
    expect(full.origin).toEqual({ x: full.frame.x, y: full.frame.y });
  });

  it('a smaller crop (zoom) is shown larger — precise selection', () => {
    const full = cropLayout({ x: 0, y: 0, width: 1, height: 1 }, image, stage, 20);
    const zoomed = cropLayout({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, image, stage, 20);
    expect(zoomed.scale).toBeCloseTo(full.scale * 2);
    // The crop's top-left maps onto the frame's top-left.
    expect(toImage(zoomed, image, { x: zoomed.frame.x, y: zoomed.frame.y })).toEqual({ x: 0.25, y: 0.25 });
    expect(frameIn(zoomed, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, image)).toEqual(zoomed.frame);
  });

  it('corner drag: opposite corner stays, stays inside, minimum size, optional fixed shape', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    const se = resizeCrop(crop, 'se', { x: 0.9, y: 0.8 }, image, 0.1, null);
    expect(se).toEqual({ x: 0.2, y: 0.2, width: expect.closeTo(0.7), height: expect.closeTo(0.6) });
    const out = resizeCrop(crop, 'nw', { x: -1, y: -1 }, image, 0.1, null);
    expect(out).toEqual({ x: 0, y: 0, width: 0.7, height: 0.7 });
    const tiny = resizeCrop(crop, 'se', { x: 0.2, y: 0.2 }, image, 0.1, null);
    expect(tiny.width).toBe(0.1);
    expect(tiny.height).toBe(0.1);
    const square = resizeCrop(crop, 'se', { x: 0.9, y: 0.4 }, image, 0.1, 1);
    expect(square.width * image.width).toBeCloseTo(square.height * image.height);
    expect(square.y + square.height).toBeLessThanOrEqual(1 + 1e-9);
  });
});
