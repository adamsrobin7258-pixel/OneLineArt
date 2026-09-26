import type { OneLineEngineParameters } from '../../engine';
import type { ImageAnalysis } from '../../imageAnalysis';
import { factorForTypicalSpacing, limitedSpacingFactor, organicSpacingParameters, type OrganicSpacingPatch } from './spacingParameters';

/** How a spacing stage is defined (Phase 15.5). */
export type SpacingSpec =
  /** Every pass spacing × factor (global). */
  | { readonly kind: 'factor'; readonly factor: number }
  /** Typical (median) pass spacing = target px at 800 px, never wider than the baseline. */
  | { readonly kind: 'typical'; readonly target: number }
  /** × factor, but the densest area never closer than `floor` px at 800 px. */
  | { readonly kind: 'limited'; readonly factor: number; readonly floor: number };

export interface SpacingVariant {
  readonly key: string;
  readonly label: string;
  readonly spec: SpacingSpec;
}

/** The stages examined in Phase 15.5 (first = the unchanged production baseline). */
export const SPACING_VARIANTS: readonly SpacingVariant[] = [
  { key: 'ref', label: 'Referenz (heute)', spec: { kind: 'factor', factor: 1 } },
  { key: 'f90', label: '−10 %', spec: { kind: 'factor', factor: 0.9 } },
  { key: 'f80', label: '−20 %', spec: { kind: 'factor', factor: 0.8 } },
  { key: 'f70', label: '−30 %', spec: { kind: 'factor', factor: 0.7 } },
  { key: 'f60', label: '−40 %', spec: { kind: 'factor', factor: 0.6 } },
  { key: 't3', label: '3 px typisch', spec: { kind: 'typical', target: 3 } },
  { key: 't25', label: '2,5 px typisch', spec: { kind: 'typical', target: 2.5 } },
  { key: 't2', label: '2 px typisch', spec: { kind: 'typical', target: 2 } },
  { key: 'b70', label: '−30 %, Boden 1 px', spec: { kind: 'limited', factor: 0.7, floor: 1 } },
  { key: 'b60', label: '−40 %, Boden 1 px', spec: { kind: 'limited', factor: 0.6, floor: 1 } },
  { key: 'b60s', label: '−40 %, Boden 1,5 px', spec: { kind: 'limited', factor: 0.6, floor: 1.5 } },
];

/** Phase 15.5 recommendation for the next phase (Balanced / Minimal; Detail stays as it is). */
export const RECOMMENDED_SPACING_VARIANT = 'b70';

export interface SpacingContext {
  readonly analysis: ImageAnalysis;
  readonly base: OneLineEngineParameters;
  readonly detail: number;
  /** Median pass spacing of the baseline line (needed for 'typical'). */
  readonly baselineMedian: number;
}

/** Spacing factor of a stage for one image (deterministic). */
export function spacingFactor(spec: SpacingSpec, c: SpacingContext): number {
  if (spec.kind === 'factor') return spec.factor;
  if (spec.kind === 'typical') return factorForTypicalSpacing(c.baselineMedian, spec.target);
  return limitedSpacingFactor(c.analysis, c.base, c.detail, spec.factor, spec.floor);
}

export function spacingPatch(spec: SpacingSpec, c: SpacingContext): OrganicSpacingPatch & { readonly factor: number } {
  const factor = spacingFactor(spec, c);
  return { ...organicSpacingParameters(c.base, factor, c.detail), factor };
}
