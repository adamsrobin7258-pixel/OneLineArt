import {
  DEFAULT_RENDER_SETTINGS,
  DRAWING_STYLE_PROFILES,
  RENDER_CONTROLS,
  SMOOTHING_RANGE,
  backgroundLightnessOf,
  backgroundLightnessPatch,
  isCustomDrawing,
  type DrawingSettings,
  type EffectiveOneLineSettings,
} from '../core';
import { Button } from '../ui/components/Button';
import { Slider } from '../ui/components/Slider';
import type { RenderSettingsController } from './state/useRenderSettings';

const percent = (v: number) => `${Math.round(v * 100)} %`;
const decimal = (v: number) => v.toFixed(2).replace('.', ',');

interface AdjustPanelProps {
  id: string;
  oneLine: EffectiveOneLineSettings;
  setDrawing: (drawing: Partial<DrawingSettings>) => void;
  render: RenderSettingsController;
}

/**
 * Fine control, hidden behind "Anpassen". Two groups:
 * - Linie (changes the path; applied when the slider is released)
 * - Darstellung (render only; applied live, the path stays the same)
 */
export function AdjustPanel({ id, oneLine, setDrawing, render }: AdjustPanelProps) {
  const { renderSettings: rs, updateRenderSettings } = render;
  const smooths = DRAWING_STYLE_PROFILES[oneLine.drawing.style].smoothing;
  const colour = rs.colorMode === 'sampled-color';
  const renderChanged =
    rs.lineWidth !== DEFAULT_RENDER_SETTINGS.lineWidth ||
    rs.lineOpacity !== DEFAULT_RENDER_SETTINGS.lineOpacity ||
    rs.background !== DEFAULT_RENDER_SETTINGS.background ||
    rs.sampling.strength !== DEFAULT_RENDER_SETTINGS.sampling.strength;

  const reset = () => {
    if (oneLine.drawing.detail !== null || oneLine.drawing.smoothing !== null) setDrawing({ detail: null, smoothing: null });
    updateRenderSettings({
      lineWidth: DEFAULT_RENDER_SETTINGS.lineWidth,
      lineOpacity: DEFAULT_RENDER_SETTINGS.lineOpacity,
      ...backgroundLightnessPatch(1),
      sampling: { ...rs.sampling, strength: DEFAULT_RENDER_SETTINGS.sampling.strength },
    });
  };

  return (
    <section id={id} className="adjust" aria-label="Anpassen" data-testid="adjust-panel">
      <div className="adjust__group" role="group" aria-labelledby={`${id}-line`}>
        <h3 id={`${id}-line`} className="adjust__title">
          Linie
        </h3>
        <Slider
          label="Detailgrad"
          value={oneLine.settings.detail}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onCommit={(detail) => setDrawing({ detail })}
        />
        <Slider
          label="Linienglättung"
          value={oneLine.parameters.smoothingIterations}
          min={SMOOTHING_RANGE.min}
          max={SMOOTHING_RANGE.max}
          step={1}
          format={(v) => (v === 0 ? 'Aus' : String(v))}
          onCommit={(smoothing) => setDrawing({ smoothing })}
          disabled={!smooths}
          hint={smooths ? undefined : 'Im geometrischen Stil bleiben die Linien gerade'}
        />
      </div>
      <div className="adjust__group" role="group" aria-labelledby={`${id}-look`}>
        <h3 id={`${id}-look`} className="adjust__title">
          Darstellung
        </h3>
        <Slider label="Linienbreite" {...RENDER_CONTROLS.lineWidth} value={rs.lineWidth} format={decimal} onChange={(lineWidth) => updateRenderSettings({ lineWidth })} />
        <Slider
          label="Zeichenstärke"
          {...RENDER_CONTROLS.drawingStrength}
          value={rs.lineOpacity}
          format={percent}
          onChange={(lineOpacity) => updateRenderSettings({ lineOpacity })}
        />
        <Slider
          label="Hintergrund"
          {...RENDER_CONTROLS.backgroundLightness}
          value={backgroundLightnessOf(rs)}
          format={percent}
          onChange={(lightness) => updateRenderSettings(backgroundLightnessPatch(lightness))}
        />
        <Slider
          label="Farbintensität"
          {...RENDER_CONTROLS.colorIntensity}
          value={rs.sampling.strength}
          format={percent}
          onChange={(strength) => updateRenderSettings({ sampling: { ...rs.sampling, strength } })}
          disabled={!colour}
          hint={colour ? undefined : 'Bei Darstellung „Farbe“'}
        />
      </div>
      <div className="adjust__actions">
        <Button variant="ghost" disabled={!isCustomDrawing(oneLine.drawing) && !renderChanged} onClick={reset}>
          Zurücksetzen
        </Button>
      </div>
    </section>
  );
}
