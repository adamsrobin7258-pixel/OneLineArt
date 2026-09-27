/**
 * Parameters of a variable-width line (Orthogonal since phase 16): lengths in
 * px of the WORKING grid, i.e. the image scaled to `workingLongEdge` on its
 * long side — a spacing of 3 means the same share of the picture for every
 * image size and every screen (it is not a display pixel).
 */
export const WIDTH_CURVES = ['perceptual', 'linear'] as const;
export type WidthCurve = (typeof WIDTH_CURVES)[number];

export interface WidthLineParameters {
  /** Long edge of the working grid, px. */
  readonly workingLongEdge: number;
  /** Distance between neighbouring passes (centre to centre), working px. */
  readonly spacing: number;
  /** Thinnest line (white paper) and thickest line (black), working px. */
  readonly minWidth: number;
  readonly maxWidth: number;
  /** −1 … 1: softer … stronger tonal contrast (0 = neutral). */
  readonly contrast: number;
  /** 0 … 2: noise-gated local contrast boost. */
  readonly detail: number;
  /** Isotropic smoothing of the tone field, Gaussian sigma in spacings. */
  readonly smoothing: number;
  readonly curve: WidthCurve;
  /** Stretch the tonal range (0.5 %…99.5 %) to black…white. */
  readonly autoLevels: boolean;
}

/** Largest width as a share of the spacing in the safe mode: a visible gap always stays between neighbouring lines. */
export const MAX_WIDTH_SHARE = 0.9;
