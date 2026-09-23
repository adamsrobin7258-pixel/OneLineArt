import type { OneLinePath, RenderedArtwork, RenderStyle } from '../models';
import { fullCursor, type PathCursor } from './pathCursor';
import { tracePath } from './tracePath';

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

/** SVG path data ("M x y L x y ...") as ONE <path> element, never several. */
export function toSvgPathData(path: OneLinePath, cursor: PathCursor = fullCursor(path)): string {
  const parts: string[] = [];
  tracePath(path, {
    moveTo: (x, y) => parts.push(`M${fmt(x)} ${fmt(y)}`),
    lineTo: (x, y) => parts.push(`L${fmt(x)} ${fmt(y)}`),
  }, cursor);
  return parts.join('');
}

export function renderSvg(path: OneLinePath, style: RenderStyle, cursor: PathCursor = fullCursor(path)): RenderedArtwork {
  const { width, height } = path.bounds;
  const bg = style.backgroundColor ? `<rect width="100%" height="100%" fill="${style.backgroundColor}"/>` : '';
  const data =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    bg +
    `<path d="${toSvgPathData(path, cursor)}" fill="none" stroke="${style.strokeColor}" ` +
    `stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return { format: 'svg', data, size: { width, height } };
}
