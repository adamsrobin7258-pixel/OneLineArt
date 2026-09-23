import { DETAIL_LEVELS, DURATION_PRESETS_MS, FINAL_HOLD_MS, timelineDurationMs, type OneLineDetailLevel } from '../core';
import { OptionGroup } from '../ui/components/OptionGroup';
import { SegmentedControl } from '../ui/components/SegmentedControl';
import { DETAIL_LEVEL_LABELS, DISPLAY_OPTIONS, displayOf } from './drawingLabels';
import type { RenderSettingsController } from './state/useRenderSettings';

const DETAIL_OPTIONS = DETAIL_LEVELS.map((value) => ({ value, label: DETAIL_LEVEL_LABELS[value].label }));
const DURATION_OPTIONS = DURATION_PRESETS_MS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` }));

export const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`.replace('.', ',');

/** Detail level with a plain-language explanation of the selection. */
export function DetailChoice({ value, onChange, fill }: { value: OneLineDetailLevel; onChange: (level: OneLineDetailLevel) => void; fill?: boolean }) {
  return (
    <OptionGroup label="Detailgrad" caption={DETAIL_LEVEL_LABELS[value].hint}>
      <SegmentedControl label="Detailgrad" options={DETAIL_OPTIONS} value={value} onChange={onChange} fill={fill ?? false} />
    </OptionGroup>
  );
}

/** Schwarz | Farbe — changes only how the same line is drawn. */
export function DisplayChoice({ render, fill }: { render: RenderSettingsController; fill?: boolean }) {
  const current = displayOf(render.renderSettings.colorMode);
  return (
    <OptionGroup label="Darstellung" caption={current.hint}>
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

/** Drawing time; the caption states the real length incl. the final hold. */
export function DurationChoice({ durationMs, onChange, fill }: { durationMs: number; onChange: (ms: number) => void; fill?: boolean }) {
  return (
    <OptionGroup label="Dauer" caption={`${seconds(durationMs)} Zeichnen + ${seconds(FINAL_HOLD_MS)} fertiges Bild = ${seconds(timelineDurationMs(durationMs))}`}>
      <SegmentedControl label="Dauer" options={DURATION_OPTIONS} value={String(durationMs)} onChange={(v) => onChange(Number(v))} fill={fill ?? false} />
    </OptionGroup>
  );
}
