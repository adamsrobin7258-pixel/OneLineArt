import type { Size } from '../../models';
import { PolylineBuilder, meanderRows, type Route, type RouteOptions } from '../../engine/maze/routes';

/** Phase 16: Route, RouteOptions and meanderRows live in the production module (engine/maze); re-exported unchanged. */
export { meanderRows, type Route, type RouteOptions } from '../../engine/maze/routes';

/** The same meander with vertical columns (rows of the transposed canvas). */
export function meanderColumns(size: Size, o: RouteOptions): Route {
  const t = meanderRows({ width: size.height, height: size.width }, { ...o, start: { x: o.start.y, y: o.start.x } });
  const coords = new Float64Array(t.coords.length);
  for (let i = 0; i < coords.length; i += 2) {
    coords[i] = t.coords[i + 1]!;
    coords[i + 1] = t.coords[i]!;
  }
  return { coords, frame: t.frame, lines: t.lines };
}

/** Largest angle step of the spiral (keeps the innermost turns round). */
const MAX_SPIRAL_ANGLE_STEP = 0.35;

/**
 * Archimedean spiral r = spacing · θ / 2π around `start`: neighbouring turns
 * are exactly `spacing` apart everywhere and the line never turns sharply.
 * It grows until it has passed every corner. Where a turn leaves the canvas,
 * the point is projected onto the border (continuous: the line runs along the
 * edge until the turn comes back) and marked as frame.
 */
export function spiral(size: Size, o: RouteOptions): Route {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const cx = o.start.x * W;
  const cy = o.start.y * H;
  const reach = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + s / 2;
  const a = s / (2 * Math.PI);
  const thetaMax = reach / a;
  const b = new PolylineBuilder(Math.ceil((Math.PI * reach * reach) / (s * o.step)) + 16);
  let theta = 0;
  for (;;) {
    const r = a * theta;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    const px = Math.min(W, Math.max(0, x));
    const py = Math.min(H, Math.max(0, y));
    b.push(px, py, px !== x || py !== y ? 1 : 0);
    if (theta >= thetaMax) break;
    theta = Math.min(thetaMax, theta + Math.min(MAX_SPIRAL_ANGLE_STEP, o.step / Math.hypot(r, a)));
  }
  return b.build(Math.ceil(thetaMax / (2 * Math.PI)));
}
