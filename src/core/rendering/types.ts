/** Minimal drawing surface; CanvasRenderingContext2D satisfies it structurally. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}
