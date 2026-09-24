import { useCallback, useState } from 'react';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings, type RenderSettings } from '../../core';

export interface RenderSettingsController {
  readonly renderSettings: RenderSettings;
  /** Validated update; a render-only change never recomputes the path. */
  readonly updateRenderSettings: (patch: Partial<RenderSettings>) => void;
}

/** App-level rendering choices (kept when the image changes). */
export function useRenderSettings(initial: () => RenderSettings = () => DEFAULT_RENDER_SETTINGS): RenderSettingsController {
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(initial);
  const updateRenderSettings = useCallback((patch: Partial<RenderSettings>) => {
    setRenderSettings((current) => sanitizeRenderSettings({ ...current, ...patch }).value);
  }, []);
  return { renderSettings, updateRenderSettings };
}
