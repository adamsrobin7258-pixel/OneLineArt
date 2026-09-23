import { useState } from 'react';
import {
  DETAIL_LEVELS,
  DRAWING_STYLES,
  DURATION_PRESETS_MS,
  DURATION_RANGE_MS,
  FINAL_HOLD_MS,
  clampDurationMs,
  isDarkBackground,
  isPresetDuration,
  timelineDurationMs,
  type DrawingStyle,
  type OneLineDetailLevel,
} from '../core';
import { OptionGroup } from '../ui/components/OptionGroup';
import { SegmentedControl } from '../ui/components/SegmentedControl';
import { Slider } from '../ui/components/Slider';
import { CUSTOM_DETAIL_LABEL, DETAIL_LEVEL_LABELS, DISPLAY_OPTIONS, DRAWING_STYLE_LABELS, LIGHT_LINE_HINT, OWN_LINE_COLOR_HINT, displayOf } from './drawingLabels';
import type { RenderSettingsController } from './state/useRenderSettings';

const DETAIL_OPTIONS = DETAIL_LEVELS.map((value) => ({ value, label: DETAIL_LEVEL_LABELS[value].label }));
const CUSTOM = 'custom' as const;
const DETAIL_OPTIONS_WITH_CUSTOM = [...DETAIL_OPTIONS, { value: CUSTOM, label: CUSTOM_DETAIL_LABEL.label }];
const STYLE_OPTIONS = DRAWING_STYLES.map((value) => ({ value, label: DRAWING_STYLE_LABELS[value].label }));
const DURATION_OPTIONS = [...DURATION_PRESETS_MS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` })), { value: 'custom', label: 'Eigene' }];

export const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`.replace('.', ',');

/**
 * Detail preset with a plain-language explanation of the selection. After a
 * manual adjustment an extra "Eigene" choice is shown selected; picking a
 * preset again restores that preset completely.
 */
export function DetailChoice({
  value,
  custom = false,
  onChange,
  fill,
}: {
  value: OneLineDetailLevel;
  custom?: boolean;
  onChange: (level: OneLineDetailLevel) => void;
  fill?: boolean;
}) {
  return (
    <OptionGroup label="Detailgrad" caption={custom ? CUSTOM_DETAIL_LABEL.hint : DETAIL_LEVEL_LABELS[value].hint}>
      <SegmentedControl
        label="Detailgrad"
        options={custom ? DETAIL_OPTIONS_WITH_CUSTOM : DETAIL_OPTIONS}
        value={custom ? CUSTOM : value}
        onChange={(next) => {
          if (next !== CUSTOM) onChange(next);
        }}
        fill={fill ?? false}
      />
    </OptionGroup>
  );
}

/** Organisch | Geometrisch — which engine draws the line. */
export function StyleChoice({ value, onChange, fill }: { value: DrawingStyle; onChange: (style: DrawingStyle) => void; fill?: boolean }) {
  return (
    <OptionGroup label="Stil" caption={DRAWING_STYLE_LABELS[value].hint}>
      <SegmentedControl label="Stil" options={STYLE_OPTIONS} value={value} onChange={onChange} fill={fill ?? false} />
    </OptionGroup>
  );
}

/** Einfarbig | Verlauf | Foto — changes only how the same line is drawn. */
export function DisplayChoice({ render, fill }: { render: RenderSettingsController; fill?: boolean }) {
  const current = displayOf(render.renderSettings.colorMode);
  const { lineColor } = render.renderSettings;
  const caption =
    current.value !== 'single' || lineColor === '#000000'
      ? current.hint
      : lineColor === '#ffffff' && isDarkBackground(render.renderSettings)
        ? LIGHT_LINE_HINT
        : OWN_LINE_COLOR_HINT;
  return (
    <OptionGroup label="Darstellung" caption={caption}>
      <SegmentedControl
        label="Darstellung"
        options={DISPLAY_OPTIONS}
        value={current.value}
        onChange={(value) => render.updateRenderSettings({ colorMode: DISPLAY_OPTIONS.find((o) => o.value === value)!.colorMode })}
        fill={fill ?? false}
      />
    </OptionGroup>
  );
}

/**
 * Drawing time: the presets or an own value (2–60 s). The caption states the
 * real length: drawing (duration ÷ speed) + the final hold of the finished artwork.
 */
export function DurationChoice({ durationMs, speed = 1, onChange, fill }: { durationMs: number; speed?: number; onChange: (ms: number) => void; fill?: boolean }) {
  const preset = isPresetDuration(durationMs);
  const [customOpen, setCustomOpen] = useState(!preset);
  const custom = customOpen || !preset;
  const drawMs = durationMs / speed;
  const speedText = speed === 1 ? '' : ` (${seconds(durationMs)} bei ${String(speed).replace('.', ',')}×)`;
  return (
    <OptionGroup label="Dauer" caption={`${seconds(drawMs)}${speedText} Zeichnen + ${seconds(FINAL_HOLD_MS)} fertiges Bild = ${seconds(timelineDurationMs(drawMs))}`}>
      <SegmentedControl
        label="Dauer"
        options={DURATION_OPTIONS}
        value={custom ? 'custom' : String(durationMs)}
        onChange={(v) => {
          setCustomOpen(v === 'custom');
          if (v !== 'custom') onChange(Number(v));
        }}
        fill={fill ?? false}
      />
      {custom && (
        <Slider
          label="Eigene Dauer"
          value={durationMs}
          min={DURATION_RANGE_MS.min}
          max={DURATION_RANGE_MS.max}
          step={DURATION_RANGE_MS.step}
          format={seconds}
          onCommit={(ms) => onChange(clampDurationMs(ms))}
        />
      )}
    </OptionGroup>
  );
}
