/**
 * Pure zoom/pan math for the image viewer. Preview-only: nothing here
 * touches the image data used for processing.
 *
 * Coordinates are CSS pixels in the container. `scale` is relative to the
 * "contain" fit (1 = whole image visible), `x`/`y` is the image's top-left.
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ViewTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

/** Largest size with the image's aspect ratio that fits the container. */
export function containSize(image: Size, container: Size): Size {
  const factor = Math.min(container.width / image.width, container.height / image.height);
  return { width: image.width * factor, height: image.height * factor };
}

export function displayedSize(view: ViewTransform, image: Size, container: Size): Size {
  const fit = containSize(image, container);
  return { width: fit.width * view.scale, height: fit.height * view.scale };
}

/** Centers axes smaller than the container, keeps larger axes covering it. */
export function clampView(view: ViewTransform, image: Size, container: Size): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const shown = displayedSize({ ...view, scale }, image, container);
  const axis = (pos: number, shownLen: number, containerLen: number): number =>
    shownLen <= containerLen ? (containerLen - shownLen) / 2 : Math.min(0, Math.max(containerLen - shownLen, pos));
  return { scale, x: axis(view.x, shown.width, container.width), y: axis(view.y, shown.height, container.height) };
}

export function fitView(image: Size, container: Size): ViewTransform {
  return clampView({ scale: 1, x: 0, y: 0 }, image, container);
}

/** Zooms by `factor` while keeping the image point under `anchor` fixed. */
export function zoomAt(view: ViewTransform, factor: number, anchor: Point, image: Size, container: Size): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView(
    { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    image,
    container,
  );
}

export function panBy(view: ViewTransform, dx: number, dy: number, image: Size, container: Size): ViewTransform {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, image, container);
}

/** Wheel delta → zoom factor. Trackpad pinch arrives as ctrl+wheel with small deltas. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * (ctrlKey ? 0.01 : 0.0025));
}
