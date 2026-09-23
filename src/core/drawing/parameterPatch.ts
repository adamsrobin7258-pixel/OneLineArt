import type { OneLineEngineParameters } from '../engine';

/** Partial engine parameters (nested pointBudget may be partial too). */
export type EngineParameterPatch = {
  readonly [K in keyof OneLineEngineParameters]?: OneLineEngineParameters[K] extends number
    ? number
    : Partial<OneLineEngineParameters[K]>;
};

/** Applies patches left to right; later patches win. */
export function applyParameterPatches(base: OneLineEngineParameters, ...patches: readonly EngineParameterPatch[]): OneLineEngineParameters {
  const out: Record<string, unknown> = { ...base };
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const current = out[key];
      out[key] = typeof value === 'object' && value !== null && typeof current === 'object' ? { ...current, ...value } : value;
    }
  }
  return out as unknown as OneLineEngineParameters;
}
