import type { OneLinePath } from '../models';
import { fullCursor, type PathCursor } from './pathCursor';
import type { PathSink } from './types';

/** Emits the path (up to `cursor`) in drawing order to any sink. */
export function tracePath(path: OneLinePath, sink: PathSink, cursor: PathCursor = fullCursor(path)): void {
  const c = path.coords;
  const n = Math.min(cursor.index, c.length >> 1);
  if (n === 0) return;
  sink.moveTo(c[0] as number, c[1] as number);
  for (let i = 1; i < n; i++) sink.lineTo(c[i * 2] as number, c[i * 2 + 1] as number);
  if (cursor.tip) sink.lineTo(cursor.tip.x, cursor.tip.y);
}
