import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER_STYLE, renderSvg, toSvgPathData, tracePath } from '../../src/core';
import { pathFrom } from '../helpers';

describe('rendering', () => {
  const path = pathFrom([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20.123, y: 0 }]);

  it('traces the path in drawing order as one moveTo + n-1 lineTo', () => {
    const ops: string[] = [];
    tracePath(path, { moveTo: (x, y) => ops.push(`M${x},${y}`), lineTo: (x, y) => ops.push(`L${x},${y}`) });
    expect(ops[0]).toBe('M0,0');
    expect(ops).toHaveLength(3);
    expect(ops.filter((o) => o.startsWith('M'))).toHaveLength(1);
  });

  it('produces SVG with exactly one <path> element', () => {
    const svg = renderSvg(path, DEFAULT_RENDER_STYLE);
    expect(svg.format).toBe('svg');
    expect(svg.data.match(/<path /g)).toHaveLength(1);
    expect(svg.data).toContain('viewBox="0 0 100 100"');
    expect(toSvgPathData(path)).toBe('M0 0L10 5L20.12 0');
  });

  it('renders a partial path up to a cursor', () => {
    expect(toSvgPathData(path, { index: 2, tip: { x: 15, y: 2.5 } })).toBe('M0 0L10 5L15 2.5');
  });

  it('escapes style values: nothing can break out of the SVG markup', () => {
    const svg = renderSvg(path, { strokeColor: '"/><script>alert(1)</script>', strokeWidth: 1, backgroundColor: "red' onload='x" });
    expect(svg.data).not.toContain('<script');
    expect(svg.data).not.toContain("'");
    expect(svg.data.match(/<path /g)).toHaveLength(1);
    expect(svg.data).toContain('stroke="&#34;/&#62;&#60;script&#62;');
  });
});
