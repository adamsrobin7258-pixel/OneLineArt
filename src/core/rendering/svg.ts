import type { OneLinePath, SvgArtwork, RenderStyle } from '../models';
import { fullCursor, type PathCursor } from './pathCursor';
import { tracePath } from './tracePath';

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Attribute values are escaped: no style value can break out of the SVG markup. */
const attr = (v: string | number): string => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** SVG path data ("M x y L x y ...") as ONE <path> element, never several. */
export function toSvgPathData(path: OneLinePath, cursor: PathCursor = fullCursor(path)): string {
  const parts: string[] = [];
  tracePath(path, {
    moveTo: (x, y) => parts.push(`M${fmt(x)} ${fmt(y)}`),
    lineTo: (x, y) => parts.push(`L${fmt(x)} ${fmt(y)}`),
  }, cursor);
  return parts.join('');
}

export function renderSvg(path: OneLinePath, style: RenderStyle, cursor: PathCursor = fullCursor(path)): SvgArtwork {
  const { width, height } = path.bounds;
  const bg = style.backgroundColor ? `<rect width="100%" height="100%" fill="${attr(style.backgroundColor)}"/>` : '';
  const data =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${attr(width)} ${attr(height)}" width="${attr(width)}" height="${attr(height)}">` +
    bg +
    `<path d="${toSvgPathData(path, cursor)}" fill="none" stroke="${attr(style.strokeColor)}" ` +
    `stroke-width="${attr(style.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return { format: 'svg', data, size: { width, height } };
}
