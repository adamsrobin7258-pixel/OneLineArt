import { useState } from 'react';
import {
  COLOR_PALETTES,
  DEFAULT_RENDER_SETTINGS,
  DRAWING_STYLE_PROFILES,
  RENDER_CONTROLS,
  SMOOTHING_RANGE,
  backgroundColorPatch,
  backgroundLightnessOf,
  backgroundLightnessPatch,
  isCustomDrawing,
  paletteOf,
  type DrawingSettings,
  type EffectiveOneLineSettings,
  type RenderSettings,
} from '../core';
import { Button } from '../ui/components/Button';
import { ColorField } from '../ui/components/ColorField';
import { SegmentedControl } from '../ui/components/SegmentedControl';
import { Slider } from '../ui/components/Slider';
import { SwatchPicker } from '../ui/components/SwatchPicker';
import type { RenderSettingsController } from './state/useRenderSettings';

const percent = (v: number) => `${Math.round(v * 100)} %`;
const decimal = (v: number) => v.toFixed(2).replace('.', ',');

const SECTIONS = [
  { value: 'line', label: 'Linie' },
  { value: 'look', label: 'Darstellung' },
  { value: 'color', label: 'Farbe' },
] as const;
type Section = (typeof SECTIONS)[number]['value'];

const BACKGROUNDS = [
  { value: 'white', label: 'Weiß' },
  { value: 'black', label: 'Schwarz' },
  { value: 'own', label: 'Eigene' },
] as const;
type BackgroundChoice = (typeof BACKGROUNDS)[number]['value'];

const PALETTE_SWATCHES = COLOR_PALETTES.map((p) => ({ value: p.id, label: p.label, colors: p.colors }));

const backgroundChoiceOf = (rs: RenderSettings): BackgroundChoice =>
  rs.backgroundBase === '#ffffff' ? 'white' : rs.backgroundBase === '#000000' ? 'black' : 'own';

interface AdjustPanelProps {
  id: string;
  oneLine: EffectiveOneLineSettings;
  setDrawing: (drawing: Partial<DrawingSettings>) => void;
  render: RenderSettingsController;
}

/**
 * Fine control, hidden behind "Anpassen", in three sections (one visible at a time):
 * - Linie: changes the path (applied when the slider is released)
 * - Darstellung / Farbe: render only (applied live; the path stays the same)
 */
export function AdjustPanel({ id, oneLine, setDrawing, render }: AdjustPanelProps) {
  const { renderSettings: rs, updateRenderSettings } = render;
  const [section, setSection] = useState<Section>('line');
  const [ownBackground, setOwnBackground] = useState(backgroundChoiceOf(rs) === 'own');
  const smooths = DRAWING_STYLE_PROFILES[oneLine.drawing.style].smoothing;
  const d = DEFAULT_RENDER_SETTINGS;
  const background = ownBackground ? 'own' : backgroundChoiceOf(rs);
  const renderChanged =
    rs.lineWidth !== d.lineWidth ||
    rs.lineOpacity !== d.lineOpacity ||
    rs.background !== d.background ||
    rs.backgroundBase !== d.backgroundBase ||
    rs.lineColor !== d.lineColor ||
    rs.gradient.colors.join() !== d.gradient.colors.join() ||
    rs.sampling.strength !== d.sampling.strength;

  const reset = () => {
    if (oneLine.drawing.detail !== null || oneLine.drawing.smoothing !== null) setDrawing({ detail: null, smoothing: null });
    setOwnBackground(false);
    updateRenderSettings({
      lineWidth: d.lineWidth,
      lineOpacity: d.lineOpacity,
      lineColor: d.lineColor,
      background: d.background,
      backgroundColor: d.backgroundColor,
      backgroundBase: d.backgroundBase,
      gradient: d.gradient,
      sampling: { ...rs.sampling, strength: d.sampling.strength },
    });
  };

  const setGradientEnd = (end: 'start' | 'end', color: string) => {
    const colors = [...rs.gradient.colors];
    colors[end === 'start' ? 0 : colors.length - 1] = color;
    updateRenderSettings({ gradient: { colors } });
  };

  const chooseBackground = (choice: BackgroundChoice) => {
    setOwnBackground(choice === 'own');
    if (choice === 'white') updateRenderSettings(backgroundColorPatch('#ffffff', rs));
    else if (choice === 'black') updateRenderSettings(backgroundColorPatch('#000000', rs));
  };

  const palette = paletteOf(rs.gradient.colors);

  return (
    <section id={id} className="adjust" aria-label="Anpassen" data-testid="adjust-panel" data-section={section}>
      <div className="adjust__head">
        <SegmentedControl label="Bereich" options={SECTIONS} value={section} onChange={setSection} />
        <Button variant="ghost" disabled={!isCustomDrawing(oneLine.drawing) && !renderChanged} onClick={reset}>
          Zurücksetzen
        </Button>
      </div>

      {section === 'line' && (
        <div className="adjust__group" role="group" aria-label="Linie">
          <Slider label="Detailgrad" value={oneLine.settings.detail} min={0} max={1} step={0.01} format={percent} onCommit={(detail) => setDrawing({ detail })} />
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
      )}

      {section === 'look' && (
        <div className="adjust__group" role="group" aria-label="Darstellung">
          <Slider label="Linienbreite" {...RENDER_CONTROLS.lineWidth} value={rs.lineWidth} format={decimal} onChange={(lineWidth) => updateRenderSettings({ lineWidth })} />
          <Slider
            label="Zeichenstärke"
            {...RENDER_CONTROLS.drawingStrength}
            value={rs.lineOpacity}
            format={percent}
            onChange={(lineOpacity) => updateRenderSettings({ lineOpacity })}
          />
          <Slider
            label="Hintergrundhelligkeit"
            {...RENDER_CONTROLS.backgroundLightness}
            value={backgroundLightnessOf(rs)}
            format={percent}
            onChange={(lightness) => updateRenderSettings(backgroundLightnessPatch(lightness, rs))}
            hint="Wirkt auf die gewählte Hintergrundfarbe"
          />
        </div>
      )}

      {section === 'color' && (
        <div className="adjust__group adjust__group--color" role="group" aria-label="Farbe">
          {rs.colorMode === 'monochrome' && <ColorField label="Linienfarbe" value={rs.lineColor} onChange={(lineColor) => updateRenderSettings({ lineColor })} />}
          {rs.colorMode === 'gradient' && (
            <>
              <div className="color-field">
                <span className="slider__label">Farbpalette</span>
                <SwatchPicker
                  label="Farbpalette"
                  options={PALETTE_SWATCHES}
                  value={palette?.id ?? null}
                  onChange={(paletteId) => updateRenderSettings({ gradient: { colors: COLOR_PALETTES.find((p) => p.id === paletteId)!.colors } })}
                />
                <span className="slider__hint">{palette ? palette.label : 'Eigener Verlauf'}</span>
              </div>
              <ColorField label="Startfarbe" value={rs.gradient.colors[0]!} onChange={(c) => setGradientEnd('start', c)} />
              <ColorField label="Endfarbe" value={rs.gradient.colors[rs.gradient.colors.length - 1]!} onChange={(c) => setGradientEnd('end', c)} />
            </>
          )}
          {rs.colorMode === 'sampled-color' && <p className="adjust__note">Die Linie übernimmt die Farben des Fotos.</p>}
          <div className="color-field">
            <span className="slider__label">Hintergrundfarbe</span>
            <SegmentedControl label="Hintergrundfarbe" options={BACKGROUNDS} value={background} onChange={chooseBackground} fill />
          </div>
          {background === 'own' && (
            <ColorField label="Eigene Hintergrundfarbe" value={rs.backgroundBase} onChange={(c) => updateRenderSettings(backgroundColorPatch(c, rs))} />
          )}
          <Slider
            label="Farbintensität"
            {...RENDER_CONTROLS.colorIntensity}
            value={rs.sampling.strength}
            format={percent}
            onChange={(strength) => updateRenderSettings({ sampling: { ...rs.sampling, strength } })}
            hint="Sättigung der Linienfarben"
          />
        </div>
      )}
    </section>
  );
}
