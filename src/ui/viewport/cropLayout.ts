/**
 * Pure layout math of the crop editor (CSS pixels). The crop frame is fitted
 * and centred in the stage; the image lies under it, magnified so that the
 * crop fills the frame — zooming in makes the frame show less of the image
 * at a larger scale, which is also what makes a precise selection possible.
 * Nothing here touches image data.
 */
import type { Point, Size } from './viewTransform';

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CropLayout {
  /** CSS px per image px (of the rotated image). */
  readonly scale: number;
  /** Top-left of the rotated image in the stage. */
  readonly origin: Point;
  /** Frame (= crop) in the stage. */
  readonly frame: CropRect;
}

/** Layout for a crop (normalized, rotated image of `image` px) in a stage. */
export function cropLayout(crop: CropRect, image: Size, stage: Size, margin: number): CropLayout {
  const cw = crop.width * image.width;
  const ch = crop.height * image.height;
  const scale = Math.max(1e-6, Math.min((stage.width - 2 * margin) / cw, (stage.height - 2 * margin) / ch));
  const frame = { x: (stage.width - cw * scale) / 2, y: (stage.height - ch * scale) / 2, width: cw * scale, height: ch * scale };
  return { scale, frame, origin: { x: frame.x - crop.x * image.width * scale, y: frame.y - crop.y * image.height * scale } };
}

/** Where a crop appears in a FIXED layout (while a frame corner is dragged). */
export function frameIn(layout: CropLayout, crop: CropRect, image: Size): CropRect {
  const s = layout.scale;
  return { x: layout.origin.x + crop.x * image.width * s, y: layout.origin.y + crop.y * image.height * s, width: crop.width * image.width * s, height: crop.height * image.height * s };
}

/** Stage point → normalized image coordinates (unclamped). */
export function toImage(layout: CropLayout, image: Size, point: Point): Point {
  return { x: (point.x - layout.origin.x) / (image.width * layout.scale), y: (point.y - layout.origin.y) / (image.height * layout.scale) };
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * New crop when `corner` is dragged to the normalized point `to`; the
 * opposite corner stays. Keeps the crop inside the image, at least `min`
 * large, and — with `aspect` (pixel width / height) — in that shape.
 */
export function resizeCrop(crop: CropRect, corner: Corner, to: Point, image: Size, min: number, aspect: number | null): CropRect {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const ax = west ? crop.x + crop.width : crop.x;
  const ay = north ? crop.y + crop.height : crop.y;
  // Room from the anchor towards the dragged corner.
  const roomX = west ? ax : 1 - ax;
  const roomY = north ? ay : 1 - ay;
  let w = Math.min(roomX, Math.max(min, west ? ax - to.x : to.x - ax));
  let h = Math.min(roomY, Math.max(min, north ? ay - to.y : to.y - ay));
  if (aspect !== null) {
    // Normalized height for this width in the given pixel aspect.
    const ratio = image.width / (aspect * image.height);
    h = w * ratio;
    if (h > roomY) {
      h = roomY;
      w = h / ratio;
    }
    if (h < min) {
      h = min;
      w = Math.min(roomX, h / ratio);
      h = w * ratio;
    }
  }
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, width: w, height: h };
}
