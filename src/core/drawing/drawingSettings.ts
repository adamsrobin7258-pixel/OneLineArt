import { DEFAULT_ONE_LINE_SETTINGS } from '../models';
import { DEFAULT_DETAIL_LEVEL, type OneLineDetailLevel } from './detailLevels';
import {
  DEFAULT_CROSSING_STYLE,
  DEFAULT_LINE_CHARACTER,
  DEFAULT_START_POINT,
  type CrossingStyle,
  type LineCharacter,
  type StartPointMode,
} from './drawingOptions';
import { DEFAULT_DRAWING_STYLE, type DrawingStyle } from './drawingStyles';
import type { EngineParameterPatch } from './parameterPatch';

/**
 * What the user (or the app) chooses. Everything else is derived:
 * DrawingSettings → resolveOneLineSettings → EffectiveOneLineSettings → engine.
 */
export interface DrawingSettings {
  /** Which engine draws the line (Organic = the original style). */
  readonly style: DrawingStyle;
  /** The chosen preset; with `detail`/`smoothing` set it is the base of a custom setting. */
  readonly detailLevel: OneLineDetailLevel;
  /** Continuous detail 0..1 (slider); null = the preset's value. */
  readonly detail: number | null;
  /** Line smoothing 0..SMOOTHING_MAX (smoothing passes); null = the preset's value. */
  readonly smoothing: number | null;
  /** Same image + same settings + same seed ⇒ same path; another seed ⇒ a variant. */
  readonly seed: number;
  /** Prepared; only 'balanced' is available so far. */
  readonly lineCharacter: LineCharacter;
  /** Prepared; only 'minimize' is available so far. */
  readonly crossingStyle: CrossingStyle;
  /** Prepared; the UI offers 'auto' only. */
  readonly startPoint: StartPointMode;
  /** Expert/developer overrides applied last (not exposed in the normal UI). */
  readonly overrides: EngineParameterPatch;
}

export const DEFAULT_DRAWING_SETTINGS: DrawingSettings = {
  style: DEFAULT_DRAWING_STYLE,
  detailLevel: DEFAULT_DETAIL_LEVEL,
  detail: null,
  smoothing: null,
  seed: DEFAULT_ONE_LINE_SETTINGS.seed,
  lineCharacter: DEFAULT_LINE_CHARACTER,
  crossingStyle: DEFAULT_CROSSING_STYLE,
  startPoint: DEFAULT_START_POINT,
  overrides: {},
};
