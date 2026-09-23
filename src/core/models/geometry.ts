/** A 2D point in image pixel space (origin top-left, y pointing down). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}
