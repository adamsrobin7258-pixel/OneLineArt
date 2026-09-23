import type { Size } from '../models';

/** Quarter turns clockwise (free rotation is not offered; the type is the extension point). */
export const IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type ImageRotation = (typeof IMAGE_ROTATIONS)[number];

/** Rectangle in normalized coordinates (0..1) of the ROTATED image. */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Non-destructive edit of an imported image: first rotate (quarter turns),
 * then cut out `crop`. Zoom and pan are not separate values but the size and
 * the position of the crop (see zoomOf / panOf): one rectangle, no chance of
 * contradicting values, and the same rectangle always gives the same pixels.
 * The original file is never touched; the edit is applied to the display copy.
 */
export interface ImageEdit {
  readonly rotation: ImageRotation;
  readonly crop: NormalizedRect;
}

export const FULL_CROP: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };
export const IDENTITY_EDIT: ImageEdit = { rotation: 0, crop: FULL_CROP };

/** Smallest crop side as a share of the image side (= largest zoom 10×). */
export const MIN_CROP_FRACTION = 0.1;
export const MAX_ZOOM = 1 / MIN_CROP_FRACTION;

export interface ImageEditIssue {
  readonly name: string;
  readonly value: unknown;
  readonly message: string;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function isIdentityEdit(edit: ImageEdit): boolean {
  const c = edit.crop;
  return edit.rotation === 0 && c.x === 0 && c.y === 0 && c.width === 1 && c.height === 1;
}

/** Keeps a crop inside the image and at least MIN_CROP_FRACTION large (moves before it shrinks). */
export function clampCrop(crop: NormalizedRect): NormalizedRect {
  const width = clamp(crop.width, MIN_CROP_FRACTION, 1);
  const height = clamp(crop.height, MIN_CROP_FRACTION, 1);
  return { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height };
}

/** Central validation: non-finite or missing values are errors; ranges are clamped (reported). */
export function sanitizeImageEdit(input: unknown): { value: ImageEdit; issues: ImageEditIssue[] } {
  const issues: ImageEditIssue[] = [];
  if (input === undefined || input === null) return { value: IDENTITY_EDIT, issues };
  const raw = input as { rotation?: unknown; crop?: Partial<Record<keyof NormalizedRect, unknown>> };
  let rotation: ImageRotation = 0;
  if ((IMAGE_ROTATIONS as readonly unknown[]).includes(raw.rotation)) rotation = raw.rotation as ImageRotation;
  else issues.push({ name: 'rotation', value: raw.rotation, message: 'rotation must be 0, 90, 180 or 270; using 0' });
  const numbers = (['x', 'y', 'width', 'height'] as const).map((k) => raw.crop?.[k]);
  if (!numbers.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    issues.push({ name: 'crop', value: raw.crop, message: 'crop must have finite x, y, width, height; using the full image' });
    return { value: { rotation, crop: FULL_CROP }, issues };
  }
  const [x, y, width, height] = numbers as [number, number, number, number];
  const crop = clampCrop({ x, y, width, height });
  if (crop.x !== x || crop.y !== y || crop.width !== width || crop.height !== height) issues.push({ name: 'crop', value: raw.crop, message: 'crop adjusted to the image' });
  return { value: { rotation, crop }, issues };
}

/** Size of the image after the rotation. */
export function rotatedSize(size: Size, rotation: ImageRotation): Size {
  return rotation === 90 || rotation === 270 ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/** Turns the image by a quarter; the crop turns with it (same content stays selected). */
export function rotateEdit(edit: ImageEdit, direction: 1 | -1): ImageEdit {
  const { x, y, width, height } = edit.crop;
  const rotation = (((edit.rotation + direction * 90) % 360) + 360) % 360 as ImageRotation;
  const crop = direction === 1 ? { x: 1 - (y + height), y: x, width: height, height: width } : { x: y, y: 1 - (x + width), width: height, height: width };
  return { rotation, crop: clampCrop(crop) };
}

/**
 * Integer pixel rectangle of the crop in the rotated `source` (e.g. the display
 * copy). Rounded once, identically for every caller, so the same edit always
 * cuts the same pixels.
 */
export function cropPixelRect(source: Size, edit: ImageEdit): { rotated: Size; x: number; y: number; width: number; height: number } {
  const rotated = rotatedSize(source, edit.rotation);
  const x0 = Math.round(edit.crop.x * rotated.width);
  const y0 = Math.round(edit.crop.y * rotated.height);
  const x1 = Math.max(x0 + 1, Math.round((edit.crop.x + edit.crop.width) * rotated.width));
  const y1 = Math.max(y0 + 1, Math.round((edit.crop.y + edit.crop.height) * rotated.height));
  return { rotated, x: x0, y: y0, width: Math.min(rotated.width, x1) - x0, height: Math.min(rotated.height, y1) - y0 };
}

/** Size of the edited image in ORIGINAL pixels (e.g. the "Original" export resolution). */
export function editedSize(original: Size, edit: ImageEdit): Size {
  const { width, height } = cropPixelRect(original, edit);
  return { width, height };
}

/** Pixel aspect ratio (width / height) of a crop in an image of `size` (rotated). */
export function cropAspect(crop: NormalizedRect, size: Size): number {
  return (crop.width * size.width) / (crop.height * size.height);
}

/** Largest crop with this pixel aspect ratio that fits the (rotated) image. */
function maxCropFor(aspect: number, size: Size): { width: number; height: number } {
  const imageAspect = size.width / size.height;
  return aspect >= imageAspect ? { width: 1, height: imageAspect / aspect } : { width: aspect / imageAspect, height: 1 };
}

/** Zoom = how much the crop enlarges the image: 1 = largest crop of this shape, up to MAX_ZOOM. */
export function zoomOf(edit: ImageEdit, size: Size): number {
  const rotated = rotatedSize(size, edit.rotation);
  return maxCropFor(cropAspect(edit.crop, rotated), rotated).width / edit.crop.width;
}

/** Pan = centre of the crop (normalized, rotated image). */
export function panOf(edit: ImageEdit): { x: number; y: number } {
  return { x: edit.crop.x + edit.crop.width / 2, y: edit.crop.y + edit.crop.height / 2 };
}

/** Sets the zoom around the current centre, keeping the shape of the crop. */
export function withZoom(edit: ImageEdit, zoom: number, size: Size): ImageEdit {
  const rotated = rotatedSize(size, edit.rotation);
  const max = maxCropFor(cropAspect(edit.crop, rotated), rotated);
  // Never smaller than the minimum on either side (keeps the shape).
  const limit = Math.min(max.width / MIN_CROP_FRACTION, max.height / MIN_CROP_FRACTION);
  const z = clamp(zoom, 1, Math.max(1, limit));
  const width = max.width / z;
  const height = max.height / z;
  const center = panOf(edit);
  return { rotation: edit.rotation, crop: clampCrop({ x: center.x - width / 2, y: center.y - height / 2, width, height }) };
}

/** Moves the crop centre (clamped to the image). */
export function withPan(edit: ImageEdit, center: { x: number; y: number }): ImageEdit {
  const { width, height } = edit.crop;
  return { rotation: edit.rotation, crop: clampCrop({ x: center.x - width / 2, y: center.y - height / 2, width, height }) };
}

/** Largest centred crop with the pixel aspect ratio `aspect` (null = keep the current crop). */
export function withCropAspect(edit: ImageEdit, aspect: number | null, size: Size): ImageEdit {
  if (aspect === null) return edit;
  const rotated = rotatedSize(size, edit.rotation);
  const { width, height } = maxCropFor(aspect, rotated);
  return { rotation: edit.rotation, crop: clampCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height }) };
}

/** Stable identity of an edit (part of cache keys of everything derived from the edited image). */
export function imageEditKey(edit: ImageEdit): string {
  const c = edit.crop;
  return `${edit.rotation}:${[c.x, c.y, c.width, c.height].map((v) => v.toFixed(6)).join(',')}`;
}
