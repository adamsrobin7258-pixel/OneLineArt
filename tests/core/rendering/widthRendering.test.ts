import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  RenderError,
  drawArtworkLine,
  drawArtworkLineRange,
  gradientLineColors,
  planArtwork,
  type OneLinePath,
  type RenderSettings,
} from '../../../src/core';
import { recordingContext, type Op } from './recordingContext';

/**
 * Phase 16: paths with a width per point (the Orthogonal style) are filled as
 * quads with square caps — exact square corners — in one fill per colour run.
 */
const path = (coords: number[], widths: number[]): OneLinePath => ({
  coords: Float32Array.from(coords),
  widths: Float32Array.from(widths),
  bounds: { width: 100, height: 100 },
  meta: { generatorId: 'test', generatorVersion: '1', seed: 0 },
});

/** An L: right, then down; the width grows along the line. */
const L = path([10, 10, 50, 10, 50, 60], [2, 4, 6]);

/** The quads drawn: 4 corners each (moveTo + 3 lineTo, then closePath). */
function quads(ops: Op[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] | null = null;
  for (const o of ops) {
    if (o.op === 'moveTo') current = [{ x: o.x, y: o.y }];
    else if (o.op === 'lineTo' && current) current.push({ x: o.x, y: o.y });
    else if (o.op === 'closePath' && current) {
      out.push(current);
      current = null;
    }
  }
  return out;
}

const box = (q: { x: number; y: number }[]) => ({
  minX: Math.min(...q.map((p) => p.x)),
  maxX: Math.max(...q.map((p) => p.x)),
  minY: Math.min(...q.map((p) => p.y)),
  maxY: Math.max(...q.map((p) => p.y)),
});

/** Signed area (orientation) of a quad. */
const area = (q: { x: number; y: number }[]) => q.reduce((s, p, i) => s + p.x * q[(i + 1) % q.length]!.y - q[(i + 1) % q.length]!.x * p.y, 0) / 2;

function draw(p: OneLinePath, settings: RenderSettings = DEFAULT_RENDER_SETTINGS, size = 100) {
  const plan = planArtwork({ path: p, settings, width: size, height: size, ...(settings.colorMode === 'gradient' ? { lineColors: gradientLineColors(p, settings.gradient.colors, 1) } : {}) });
  const ctx = recordingContext();
  drawArtworkLine(plan, p, ctx);
  return { plan, ops: ctx.ops };
}

describe('16 variable-width drawing', () => {
  it('one filled quad per segment, square caps: the corner of an L is filled exactly (no stroke)', () => {
    const { ops } = draw(L);
    expect(ops.filter((o) => o.op === 'stroke')).toHaveLength(0);
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(1);
    const [a, b] = quads(ops);
    expect(quads(ops)).toHaveLength(2);
    // Horizontal leg: width 2 → 4, extended by half the width at both ends.
    expect(box(a!)).toEqual({ minX: 9, maxX: 52, minY: 8, maxY: 12 });
    // Vertical leg: width 4 → 6, starting half a width above the corner: together they cover the corner square.
    expect(box(b!)).toEqual({ minX: 47, maxX: 53, minY: 8, maxY: 63 });
    // Same orientation for every quad: a nonzero fill draws their union.
    expect(Math.sign(area(a!))).toBe(Math.sign(area(b!)));
  });

  it('scales with the render size and takes the line-width setting as a factor', () => {
    const [q1] = quads(draw(L, DEFAULT_RENDER_SETTINGS, 200).ops);
    expect(box(q1!)).toEqual({ minX: 18, maxX: 104, minY: 16, maxY: 24 });
    const [q2] = quads(draw(L, { ...DEFAULT_RENDER_SETTINGS, lineWidth: 2 }).ops);
    expect(box(q2!)).toEqual({ minX: 8, maxX: 54, minY: 6, maxY: 14 });
  });

  it('animation: drawing up to a tip and on from there continues exactly (width interpolated at the tip)', () => {
    const plan = planArtwork({ path: L, settings: DEFAULT_RENDER_SETTINGS, width: 100, height: 100 });
    const tip = { index: 1, tip: { x: 30, y: 10 } }; // point 0 drawn, the first leg up to its middle
    const first = recordingContext();
    drawArtworkLineRange(plan, L, first, null, tip);
    const [part] = quads(first.ops);
    expect(quads(first.ops)).toHaveLength(1);
    // Width at the tip: 3 (halfway between 2 and 4).
    expect(box(part!)).toEqual({ minX: 9, maxX: 31.5, minY: 8.5, maxY: 11.5 });
    const rest = recordingContext();
    drawArtworkLineRange(plan, L, rest, tip, { index: 3, tip: null });
    const [a, b] = quads(rest.ops);
    expect(quads(rest.ops)).toHaveLength(2);
    expect(box(a!)).toEqual({ minX: 28.5, maxX: 52, minY: 8, maxY: 12 });
    expect(box(b!).maxY).toBe(63);
    // Nothing new to draw → nothing drawn.
    const none = recordingContext();
    drawArtworkLineRange(plan, L, none, tip, tip);
    expect(none.ops).toEqual([]);
  });

  it('colour runs (gradient, photo): one fill per run, each with its colour', () => {
    const long = path(
      Array.from({ length: 40 }, (_, i) => [i % 2 ? 90 : 10, 5 + i * 2]).flat(),
      Array.from({ length: 40 }, () => 1),
    );
    const { ops } = draw(long, { ...DEFAULT_RENDER_SETTINGS, colorMode: 'gradient', gradient: { colors: ['#ff0000', '#0000ff'] } });
    const fills = ops.filter((o): o is Extract<Op, { op: 'fill' }> => o.op === 'fill');
    expect(fills.length).toBeGreaterThan(3);
    expect(new Set(fills.map((f) => f.style)).size).toBe(fills.length);
    expect(quads(ops)).toHaveLength(39);
  });

  it('a path without widths is still drawn as ONE stroke (Organic unchanged)', () => {
    const plain: OneLinePath = { coords: L.coords, bounds: L.bounds, meta: L.meta };
    const { ops } = draw(plain);
    expect(ops.filter((o) => o.op === 'stroke')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(0);
  });

  it('invalid widths are refused like invalid coordinates', () => {
    for (const widths of [[1, 1], [1, Number.NaN, 1], [1, 0, 1], [1, -2, 1]]) {
      expect(() => planArtwork({ path: { ...L, widths: Float32Array.from(widths) }, settings: DEFAULT_RENDER_SETTINGS, width: 100, height: 100 })).toThrow(RenderError);
    }
  });
});
