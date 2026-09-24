import { GEOMETRIC_ENGINE_ID, ONE_LINE_ENGINE_ID, ORTHOGONAL_ENGINE_ID } from '../engine';
import type { EngineParameterPatch } from './parameterPatch';

/** The user-facing drawing styles. */
export const DRAWING_STYLES = ['organic', 'geometric', 'orthogonal'] as const;
export type DrawingStyle = (typeof DRAWING_STYLES)[number];
export const DEFAULT_DRAWING_STYLE: DrawingStyle = 'organic';

export interface DrawingStyleProfile {
  /** Engine (registry id) that generates this style's path. */
  readonly engineId: string;
  /** Engine parameters this style changes on top of the detail profile. */
  readonly parameters: EngineParameterPatch;
  /** Whether the style uses line smoothing (the smoothing control applies). */
  readonly smoothing: boolean;
}

/**
 * THE place where styles are defined. A new style = a new engine in the
 * engine registry + one entry here; nothing else branches on the style.
 */
export const DRAWING_STYLE_PROFILES: Readonly<Record<DrawingStyle, DrawingStyleProfile>> = {
  // The phase 4–11 engine, unchanged.
  organic: { engineId: ONE_LINE_ENGINE_ID, parameters: {}, smoothing: true },
  // Same route, drawn with straight 45°/90° lines; smoothing would round its corners.
  geometric: { engineId: GEOMETRIC_ENGINE_ID, parameters: {}, smoothing: false },
  // Own route (Manhattan tour, L-corners): only horizontal and vertical lines.
  orthogonal: { engineId: ORTHOGONAL_ENGINE_ID, parameters: {}, smoothing: false },
};
