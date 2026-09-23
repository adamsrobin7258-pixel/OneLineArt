import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_SAMPLING,
  DEFAULT_RENDER_SETTINGS,
  REFERENCE_RENDER_EDGE,
  RenderError,
  createPath,
  describeArtwork,
  drawArtworkBackground,
  drawArtworkLine,
  hashBytes,
  planArtwork,
  renderSize,
  sampleLineColors,
  type OneLinePath,
  type RenderSettings,
} from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import { recordingContext, type Op } from './recordingContext';

function zigzag(width: number, height: number, points = 200): OneLinePath {
  return createPath(
    Array.from({ length: points }, (_, i) => ({ x: (i / (points - 1)) * width, y: i % 2 ? height * 0.8 : height * 0.2 })),
    { width, height },
    { generatorId: 'test', generatorVersion: '1', seed: 0 },
  );
}

const lineOps = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'moveTo' | 'lineTo' }> => o.op === 'moveTo' || o.op === 'lineTo');

function draw(path: OneLinePath, settings: RenderSettings, longEdge = 1000, image = raster(path.bounds.width, path.bounds.height, (x) => (x < path.bounds.width / 2 ? [200, 30, 30] : [30, 30, 200]))) {
  const size = renderSize(path.bounds, longEdge);
  const lineColors = settings.colorMode === 'sampled-color' ? sampleLineColors(path, image, settings.sampling) : null;
  const plan = planArtwork({ path, settings, ...size, lineColors });
  const ctx = recordingContext();
  drawArtworkBackground(plan, ctx, settings.background === 'original' ? { photo: true } : undefined);
  drawArtworkLine(plan, path, ctx);
  return { plan, ops: ctx.ops, lineColors };
}

describe('render size and aspect ratio', () => {
  it.each([
    ['1:1', 800, 800],
    ['4:3', 1600, 1200],
    ['3:4', 1200, 1600],
    ['16:9', 1920, 1080],
  ])('%s keeps its proportions at several target sizes', (_, w, h) => {
    for (const edge of [256, 1000, 2048, 4000]) {
      const size = renderSize({ width: w, height: h }, edge);
      expect(Math.max(size.width, size.height)).toBe(edge);
      expect(Math.abs(size.width / size.height - w / h)).toBeLessThanOrEqual((w / h) / Math.min(size.width, size.height));
      expect(() => planArtwork({ path: zigzag(w, h), settings: DEFAULT_RENDER_SETTINGS, ...size })).not.toThrow();
    }
  });

  it('refuses sizes that would distort or crop the artwork', () => {
    expect(() => planArtwork({ path: zigzag(1600, 1200), settings: DEFAULT_RENDER_SETTINGS, width: 1000, height: 1000 })).toThrow(RenderError);
    expect(() => planArtwork({ path: zigzag(100, 100), settings: DEFAULT_RENDER_SETTINGS, width: 0, height: 0 })).toThrow(RenderError);
    expect(() => planArtwork({ path: zigzag(100, 100), settings: DEFAULT_RENDER_SETTINGS, width: 99999, height: 99999 })).toThrow(RenderError);
  });

  it('line width is resolution-normalized (same relative width at any size)', () => {
    const path = zigzag(400, 300);
    const at = (edge: number) => draw(path, DEFAULT_RENDER_SETTINGS, edge).plan.lineWidthPx / edge;
    expect(draw(path, DEFAULT_RENDER_SETTINGS, REFERENCE_RENDER_EDGE).plan.lineWidthPx).toBeCloseTo(DEFAULT_RENDER_SETTINGS.lineWidth);
    expect(at(1000)).toBeCloseTo(at(4000), 10);
    expect(at(1000)).toBeCloseTo(at(250), 10);
  });
});

describe('monochrome rendering', () => {
  const path = zigzag(400, 300);
  const { ops, plan } = draw(path, DEFAULT_RENDER_SETTINGS, 800);

  it('draws a white background and ONE black stroke', () => {
    expect(ops.find((o) => o.op === 'fillRect')).toMatchObject({ style: '#ffffff', w: 800, h: 600 });
    const strokes = ops.filter((o) => o.op === 'stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ style: '#000000', alpha: 1 });
    expect(lineOps(ops).filter((o) => o.op === 'moveTo')).toHaveLength(1);
  });

  it('uses exactly the OneLinePath points, scaled to the render size', () => {
    const drawn = lineOps(ops);
    expect(drawn).toHaveLength(path.coords.length / 2);
    drawn.forEach((o, i) => {
      expect(o.x).toBeCloseTo(path.coords[i * 2]! * plan.scaleX, 4);
      expect(o.y).toBeCloseTo(path.coords[i * 2 + 1]! * plan.scaleY, 4);
    });
  });

  it('supports any line colour', () => {
    const { ops: custom } = draw(path, { ...DEFAULT_RENDER_SETTINGS, lineColor: '#1d3557' });
    expect(custom.find((o) => o.op === 'stroke')).toMatchObject({ style: '#1d3557' });
  });
});

describe('colour rendering', () => {
  const path = zigzag(400, 300, 400);
  const settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' };
  const { ops, plan, lineColors } = draw(path, settings, 800);

  it('draws the SAME point sequence in consecutive colour runs, without gaps or extra lines', () => {
    const drawn = lineOps(ops);
    const strokes = ops.filter((o) => o.op === 'stroke');
    expect(plan.stroke.kind).toBe('runs');
    expect(strokes.length).toBeGreaterThan(1);
    // Every run starts exactly where the previous one ended.
    let lastPoint: { x: number; y: number } | null = null;
    let lineTos = 0;
    for (const o of drawn) {
      if (o.op === 'moveTo') {
        if (lastPoint) expect([o.x, o.y]).toEqual([lastPoint.x, lastPoint.y]);
        else expect([o.x, o.y]).toEqual([path.coords[0]! * plan.scaleX, path.coords[1]! * plan.scaleY]);
      } else lineTos++;
      lastPoint = { x: o.x, y: o.y };
    }
    // n − 1 segments in total: nothing skipped, nothing doubled.
    expect(lineTos).toBe(path.coords.length / 2 - 1);
    expect(lastPoint).toEqual({ x: path.coords[path.coords.length - 2]! * plan.scaleX, y: path.coords[path.coords.length - 1]! * plan.scaleY });
  });

  it('colours come from the image (red left, blue right)', () => {
    const strokes = ops.filter((o): o is Extract<Op, { op: 'stroke' }> => o.op === 'stroke');
    const first = String(strokes[0]!.style);
    const last = String(strokes[strokes.length - 1]!.style);
    expect(parseInt(first.slice(1, 3), 16)).toBeGreaterThan(parseInt(first.slice(5, 7), 16));
    expect(parseInt(last.slice(5, 7), 16)).toBeGreaterThan(parseInt(last.slice(1, 3), 16));
    for (const s of strokes) expect(String(s.style)).toMatch(/^#[0-9a-f]{6}$/);
    expect(lineColors).not.toBeNull();
  });

  it('refuses colours sampled for another path', () => {
    const other = zigzag(400, 300, 50);
    const wrong = sampleLineColors(other, raster(400, 300, () => 100), DEFAULT_COLOR_SAMPLING);
    expect(() => planArtwork({ path, settings, width: 800, height: 600, lineColors: wrong })).toThrow(RenderError);
    expect(() => planArtwork({ path, settings, width: 800, height: 600 })).toThrow(RenderError);
  });
});

describe('path integrity and determinism', () => {
  it('rendering never changes the path data', () => {
    const path = zigzag(300, 300);
    const before = hashBytes(new Uint8Array(path.coords.buffer));
    draw(path, DEFAULT_RENDER_SETTINGS);
    draw(path, { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' });
    expect(hashBytes(new Uint8Array(path.coords.buffer))).toBe(before);
  });

  it('identical input ⇒ identical drawing', () => {
    const path = zigzag(300, 200);
    const settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' };
    expect(draw(path, settings).ops).toEqual(draw(path, settings).ops);
  });

  it('never modifies the image used for sampling', () => {
    const image = raster(300, 200, (x, y) => [(x * 5) % 256, (y * 3) % 256, 90]);
    const before = hashBytes(image.data);
    draw(zigzag(300, 200), { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' }, 1000, image);
    expect(hashBytes(image.data)).toBe(before);
  });

  it('partial drawing (for the later animation) draws a prefix of the same line', () => {
    const path = zigzag(300, 200, 50);
    for (const settings of [DEFAULT_RENDER_SETTINGS, { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' as const }]) {
      const { plan } = draw(path, settings);
      const ctx = recordingContext();
      drawArtworkLine(plan, path, ctx, { index: 10, tip: { x: 100, y: 100 } });
      const drawn = lineOps(ctx.ops).filter((o) => o.op === 'lineTo');
      expect(drawn).toHaveLength(10); // 9 full segments + the partial tip
      expect(drawn[drawn.length - 1]).toMatchObject({ x: 100 * plan.scaleX, y: 100 * plan.scaleY });
    }
  });
});

describe('backgrounds and metrics', () => {
  const path = zigzag(300, 200);

  it.each([
    ['white', '#ffffff'],
    ['black', '#000000'],
  ] as const)('%s background', (background, color) => {
    expect(draw(path, { ...DEFAULT_RENDER_SETTINGS, background }).ops.find((o) => o.op === 'fillRect')).toMatchObject({ style: color });
  });

  it('custom, transparent and original backgrounds', () => {
    expect(draw(path, { ...DEFAULT_RENDER_SETTINGS, background: 'custom', backgroundColor: '#f4efe6' }).ops.find((o) => o.op === 'fillRect')).toMatchObject({ style: '#f4efe6' });
    expect(draw(path, { ...DEFAULT_RENDER_SETTINGS, background: 'transparent' }).ops.filter((o) => o.op === 'fillRect')).toHaveLength(0);
    const original = draw(path, { ...DEFAULT_RENDER_SETTINGS, background: 'original' }).ops.find((o) => o.op === 'drawImage');
    expect(original).toMatchObject({ image: { photo: true } });
    const plan = planArtwork({ path, settings: { ...DEFAULT_RENDER_SETTINGS, background: 'original' }, width: 300, height: 200 });
    expect(() => drawArtworkBackground(plan, recordingContext())).toThrow(RenderError);
  });

  it('describes the rendering reproducibly', () => {
    const { plan, lineColors } = draw(path, { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color', lineOpacity: 0.8 }, 900);
    const m = describeArtwork(plan, path, lineColors);
    expect(m).toMatchObject({ renderWidth: 900, renderHeight: 600, renderColorMode: 'sampled-color', renderBackgroundMode: 'white', lineOpacity: 0.8, pathPoints: 200, colorSampling: true });
    expect(m.lineWidthPx).toBeCloseTo(0.9);
    expect(m.sampleCount).toBe(lineColors!.stations);
    expect(describeArtwork(plan, path, lineColors)).toEqual(m);
  });
});
