import type { OneLinePath, Point } from '../models';

/**
 * A position along the path: all points before `index` are fully drawn,
 * plus a partial segment ending at `tip`. The finished artwork is simply the
 * cursor at the end, so animation frames and final render share one code path.
 */
export interface PathCursor {
  /** Number of complete points drawn (1..pointCount). */
  readonly index: number;
  /** End of the partially drawn segment, or null if none. */
  readonly tip: Point | null;
}

export function fullCursor(path: OneLinePath): PathCursor {
  return { index: path.coords.length >> 1, tip: null };
}
