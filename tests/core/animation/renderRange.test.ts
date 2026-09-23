import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  createPath,
  createPathProgress,
  cursorAtProgress,
  drawArtworkLine,
  drawArtworkLineRange,
  planArtwork,
  renderSize,
  sampleLineColors,
  type OneLinePath,
  type RenderSettings,
} from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import { recordingContext, type Op } from '../rendering/recordingContext';

function wavy(points = 300): OneLinePath {
  return createPath(
    Array.from({ length: points }, (_, i) => ({ x: 5 + (i / (points - 1)) * 390, y: 150 + Math.sin(i * 0.7) * (i % 5 === 0 ? 120 : 30) })),
    { width: 400, height: 300 },
    { generatorId: 't', generatorVersion: '1', seed: 0 },
  );
}

/** The drawn geometry as a list of segments [x0,y0,x1,y1], in order. */
function segments(ops: Op[]): number[][] {
  const out: number[][] = [];
  let last: [number, number] | null = null;
  for (const o of ops) {
    if (o.op === 'moveTo') last = [o.x, o.y];
    else if (o.op === 'lineTo') {
      out.push([last![0], last![1], o.x, o.y]);
      last = [o.x, o.y];
    }
  }
  return out;
}

const modes: [string, RenderSettings][] = [
  ['black', DEFAULT_RENDER_SETTINGS],
  ['colour', { ...DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' }],
];

for (const [name, settings] of modes) {
  describe(`incremental animation drawing (${name})`, () => {
    const path = wavy();
    const size = renderSize(path.bounds, 800);
    const lineColors = settings.colorMode === 'sampled-color' ? sampleLineColors(path, raster(400, 300, (x) => (x < 200 ? [200, 40, 40] : [40, 40, 200])), settings.sampling) : null;
    const plan = planArtwork({ path, settings, ...size, lineColors });
    const index = createPathProgress(path);

    it('frames ending at points add up to exactly the static drawing', () => {
      const incremental = recordingContext();
      let previous = null;
      for (const i of [0, 3, 4, 40, 41, 150, 299]) {
        const cursor = cursorAtProgress(index, index.cumulative[i]! / index.totalLength);
        drawArtworkLineRange(plan, path, incremental, previous, cursor);
        previous = cursor;
      }
      const whole = recordingContext();
      drawArtworkLine(plan, path, whole);
      expect(segments(incremental.ops)).toEqual(segments(whole.ops));
    });

    it('with arbitrary positions, the drawn points are exactly the path points in order (plus tips)', () => {
      const ctx = recordingContext();
      let previous = null;
      for (const p of [0.013, 0.2, 0.2, 0.4999, 0.5, 0.77, 0.999, 1]) {
        const cursor = cursorAtProgress(index, p);
        drawArtworkLineRange(plan, path, ctx, previous, cursor);
        previous = cursor;
      }
      const vertices = new Set(Array.from({ length: path.coords.length / 2 }, (_, i) => `${path.coords[i * 2]! * plan.scaleX},${path.coords[i * 2 + 1]! * plan.scaleY}`));
      const drawn: string[] = [];
      for (const o of ctx.ops) {
        if (o.op !== 'moveTo' && o.op !== 'lineTo') continue;
        const key = `${o.x},${o.y}`;
        if (vertices.has(key) && drawn[drawn.length - 1] !== key) drawn.push(key);
      }
      expect(drawn).toEqual([...vertices]);
    });

    it('each frame continues exactly where the previous one ended (no gap, no jump)', () => {
      const ctx = recordingContext();
      let previous = null;
      let lastEnd: [number, number] | null = null;
      for (let k = 0; k <= 60; k++) {
        const cursor = cursorAtProgress(index, k / 60);
        const before = ctx.ops.length;
        drawArtworkLineRange(plan, path, ctx, previous, cursor);
        const frameOps = ctx.ops.slice(before).filter((o) => o.op === 'moveTo' || o.op === 'lineTo') as { op: string; x: number; y: number }[];
        if (frameOps.length) {
          if (lastEnd) expect([frameOps[0]!.x, frameOps[0]!.y]).toEqual(lastEnd);
          const tail = frameOps[frameOps.length - 1]!;
          lastEnd = [tail.x, tail.y];
        }
        previous = cursor;
      }
      expect(lastEnd).toEqual([path.coords[path.coords.length - 2]! * plan.scaleX, path.coords[path.coords.length - 1]! * plan.scaleY]);
    });

    it('a frame only draws the new piece (cost does not grow with progress)', () => {
      const late = recordingContext();
      drawArtworkLineRange(plan, path, late, cursorAtProgress(index, 0.9), cursorAtProgress(index, 0.91));
      expect(late.ops.filter((o) => o.op === 'lineTo').length).toBeLessThan(15);
    });

    it('nothing is drawn when the cursor did not move', () => {
      const ctx = recordingContext();
      const c = cursorAtProgress(index, 0.4);
      drawArtworkLineRange(plan, path, ctx, c, c);
      expect(ctx.ops).toHaveLength(0);
    });
  });
}

describe('progress 0 and 1 with the static renderer', () => {
  const path = wavy(50);
  const plan = planArtwork({ path, settings: DEFAULT_RENDER_SETTINGS, ...renderSize(path.bounds, 500) });
  const index = createPathProgress(path);

  it('progress 0 draws no line', () => {
    const ctx = recordingContext();
    drawArtworkLine(plan, path, ctx, cursorAtProgress(index, 0));
    expect(ctx.ops.filter((o) => o.op === 'lineTo')).toHaveLength(0);
  });

  it('progress 1 draws exactly the static artwork', () => {
    const a = recordingContext();
    const b = recordingContext();
    drawArtworkLine(plan, path, a, cursorAtProgress(index, 1));
    drawArtworkLine(plan, path, b);
    expect(a.ops).toEqual(b.ops);
  });
});
