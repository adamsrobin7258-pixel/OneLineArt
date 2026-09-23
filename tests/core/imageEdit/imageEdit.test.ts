import { describe, expect, it } from 'vitest';
import {
  IDENTITY_EDIT,
  MAX_ZOOM,
  MIN_CROP_FRACTION,
  cropPixelRect,
  editedSize,
  imageEditKey,
  isIdentityEdit,
  panOf,
  rotateEdit,
  rotatedSize,
  sanitizeImageEdit,
  withCropAspect,
  withPan,
  withZoom,
  zoomOf,
  type ImageEdit,
} from '../../../src/core';

const photo = { width: 4000, height: 3000 };
const edit = (rotation: ImageEdit['rotation'], x: number, y: number, width: number, height: number): ImageEdit => ({ rotation, crop: { x, y, width, height } });

describe('image edit state', () => {
  it('the identity edit leaves the image as it is', () => {
    expect(isIdentityEdit(IDENTITY_EDIT)).toBe(true);
    expect(editedSize(photo, IDENTITY_EDIT)).toEqual(photo);
    expect(cropPixelRect(photo, IDENTITY_EDIT)).toEqual({ rotated: photo, x: 0, y: 0, width: 4000, height: 3000 });
    expect(sanitizeImageEdit(undefined)).toEqual({ value: IDENTITY_EDIT, issues: [] });
  });

  it('crop: the rectangle in pixels is rounded once, identically every time', () => {
    const e = edit(0, 0.1, 0.2, 0.5, 0.4);
    expect(cropPixelRect(photo, e)).toEqual({ rotated: photo, x: 400, y: 600, width: 2000, height: 1200 });
    expect(cropPixelRect(photo, e)).toEqual(cropPixelRect(photo, e));
    expect(editedSize(photo, e)).toEqual({ width: 2000, height: 1200 });
    // Odd sizes: the rectangle never leaves the image.
    const odd = cropPixelRect({ width: 333, height: 211 }, edit(0, 1 / 3, 0.5, 2 / 3, 0.5));
    expect(odd.x + odd.width).toBeLessThanOrEqual(333);
    expect(odd.y + odd.height).toBeLessThanOrEqual(211);
  });

  it('rotation: quarter turns swap the sides; the crop turns with the content', () => {
    expect(rotatedSize(photo, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(photo, 180)).toEqual(photo);
    const e = edit(0, 0.1, 0.2, 0.3, 0.4);
    const right = rotateEdit(e, 1);
    expect(right.rotation).toBe(90);
    // Top-left content region moves to the top-right after a clockwise turn.
    expect(right.crop.x).toBeCloseTo(1 - (0.2 + 0.4));
    expect(right.crop.y).toBeCloseTo(0.1);
    expect(right.crop.width).toBeCloseTo(0.4);
    expect(right.crop.height).toBeCloseTo(0.3);
    // Pixel size of the crop is the same, only turned.
    const before = editedSize(photo, e);
    const after = editedSize(photo, right);
    expect(after).toEqual({ width: before.height, height: before.width });
    // Four turns (either way) give the same edit back.
    let turned = e;
    for (let i = 0; i < 4; i++) turned = rotateEdit(turned, 1);
    expect(turned.rotation).toBe(0);
    expect(turned.crop.x).toBeCloseTo(e.crop.x);
    expect(turned.crop.y).toBeCloseTo(e.crop.y);
    expect(rotateEdit(rotateEdit(e, 1), -1).crop.x).toBeCloseTo(e.crop.x);
  });

  it('zoom: the crop gets smaller around its centre, keeping its shape; limited to MAX_ZOOM', () => {
    const z2 = withZoom(IDENTITY_EDIT, 2, photo);
    expect(zoomOf(z2, photo)).toBeCloseTo(2);
    expect(panOf(z2)).toEqual({ x: 0.5, y: 0.5 });
    expect(z2.crop.width).toBeCloseTo(0.5);
    expect(z2.crop.height).toBeCloseTo(0.5);
    expect(zoomOf(withZoom(IDENTITY_EDIT, 99, photo), photo)).toBeCloseTo(MAX_ZOOM);
    expect(zoomOf(withZoom(z2, 0.2, photo), photo)).toBeCloseTo(1);
    // Shape stays: a 1:1 crop stays square in pixels.
    const square = withZoom(withCropAspect(IDENTITY_EDIT, 1, photo), 3, photo);
    const px = editedSize(photo, square);
    expect(Math.abs(px.width - px.height)).toBeLessThanOrEqual(1);
  });

  it('pan: moves the crop, never outside the image', () => {
    const z2 = withZoom(IDENTITY_EDIT, 2, photo);
    expect(panOf(withPan(z2, { x: 0.3, y: 0.6 }))).toEqual({ x: 0.3, y: 0.6 });
    const far = withPan(z2, { x: 5, y: -5 });
    expect(far.crop.x + far.crop.width).toBeCloseTo(1);
    expect(far.crop.y).toBe(0);
  });

  it('aspect presets: largest centred crop of that shape', () => {
    const square = withCropAspect(IDENTITY_EDIT, 1, photo);
    expect(square.crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    const wide = withCropAspect(IDENTITY_EDIT, 16 / 9, photo);
    expect(wide.crop.width).toBe(1);
    expect(editedSize(photo, wide).width / editedSize(photo, wide).height).toBeCloseTo(16 / 9, 2);
    expect(withCropAspect(square, null, photo)).toBe(square);
  });

  it('validation: bad values are reported, crops are kept inside and not too small', () => {
    expect(sanitizeImageEdit({ rotation: 45, crop: { x: 0, y: 0, width: 1, height: 1 } }).issues.map((i) => i.name)).toEqual(['rotation']);
    const nan = sanitizeImageEdit({ rotation: 90, crop: { x: Number.NaN, y: 0, width: 1, height: 1 } });
    expect(nan.value).toEqual({ rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 } });
    expect(nan.issues.map((i) => i.name)).toEqual(['crop']);
    const tiny = sanitizeImageEdit({ rotation: 0, crop: { x: 0.95, y: 0.95, width: 0.01, height: 0.01 } }).value.crop;
    expect(tiny.width).toBe(MIN_CROP_FRACTION);
    expect(tiny.x + tiny.width).toBeLessThanOrEqual(1);
    const valid = edit(180, 0.1, 0.1, 0.5, 0.5);
    expect(sanitizeImageEdit(valid)).toEqual({ value: valid, issues: [] });
  });

  it('the key identifies an edit (same edit ⇒ same key)', () => {
    expect(imageEditKey(edit(90, 0.1, 0.2, 0.3, 0.4))).toBe(imageEditKey(edit(90, 0.1, 0.2, 0.3, 0.4)));
    expect(imageEditKey(edit(90, 0.1, 0.2, 0.3, 0.4))).not.toBe(imageEditKey(edit(270, 0.1, 0.2, 0.3, 0.4)));
  });
});
