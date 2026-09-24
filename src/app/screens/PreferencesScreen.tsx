import { FACTORY_WORK_DEFAULTS, RENDER_CONTROLS, SPEED_PRESETS, type AnimationDirection, type DefaultBackground, type WorkDefaults } from '../../core';
import { Button } from '../../ui/components/Button';
import { Icon } from '../../ui/components/Icon';
import { OptionGroup } from '../../ui/components/OptionGroup';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { DetailChoice, DurationChoice, StyleChoice } from '../controls';

const BACKGROUND_OPTIONS: readonly { value: DefaultBackground; label: string }[] = [
  { value: 'white', label: 'Weiß' },
  { value: 'black', label: 'Schwarz' },
];
const SPEED_OPTIONS = SPEED_PRESETS.map((v) => ({ value: String(v), label: `${String(v).replace('.', ',')}×` }));
const DIRECTION_OPTIONS: readonly { value: AnimationDirection; label: string }[] = [
  { value: 'forward', label: 'Vorwärts' },
  { value: 'reverse', label: 'Rückwärts' },
];
const LOOP_OPTIONS = [
  { value: 'once', label: 'Einmal' },
  { value: 'loop', label: 'Endlos' },
] as const;

interface PreferencesScreenProps {
  defaults: WorkDefaults;
  onChange: (defaults: WorkDefaults) => void;
  onBack: () => void;
}

const same = (a: WorkDefaults, b: WorkDefaults) => (Object.keys(a) as (keyof WorkDefaults)[]).every((k) => a[k] === b[k]);

/**
 * "Einstellungen" (13.8): starting values for NEW works. Saved works keep
 * their own values — opening one never takes anything from here.
 */
export function PreferencesScreen({ defaults, onChange, onBack }: PreferencesScreenProps) {
  const set = (patch: Partial<WorkDefaults>) => onChange({ ...defaults, ...patch });
  return (
    <section className="preferences" data-testid="preferences-screen">
      <header className="gallery__header">
        <div>
          <h1 className="gallery__heading">Einstellungen</h1>
          <p className="gallery__count">Standardwerte für neue Werke. Gespeicherte Werke behalten ihre eigenen Einstellungen.</p>
        </div>
        <Button variant="quiet" onClick={onBack}>
          <Icon name="arrowLeft" size={18} />
          Zurück
        </Button>
      </header>

      <div className="preferences__groups">
        <fieldset className="preferences__group">
          <legend className="export__title">Zeichnung</legend>
          <StyleChoice value={defaults.style} onChange={(style) => set({ style })} fill />
          <DetailChoice value={defaults.detailLevel} onChange={(detailLevel) => set({ detailLevel })} fill />
        </fieldset>

        <fieldset className="preferences__group">
          <legend className="export__title">Darstellung</legend>
          <OptionGroup label="Hintergrund">
            <SegmentedControl label="Hintergrund" options={BACKGROUND_OPTIONS} value={defaults.background} onChange={(background) => set({ background })} fill />
          </OptionGroup>
          <Slider
            label="Linienbreite"
            value={defaults.lineWidth}
            {...RENDER_CONTROLS.lineWidth}
            format={(v) => v.toFixed(2).replace('.', ',')}
            onCommit={(lineWidth) => set({ lineWidth })}
          />
        </fieldset>

        <fieldset className="preferences__group">
          <legend className="export__title">Animation</legend>
          <DurationChoice durationMs={defaults.durationMs} speed={defaults.speed} onChange={(durationMs) => set({ durationMs })} fill />
          <OptionGroup label="Geschwindigkeit">
            <SegmentedControl label="Geschwindigkeit" options={SPEED_OPTIONS} value={String(defaults.speed)} onChange={(v) => set({ speed: Number(v) })} fill />
          </OptionGroup>
          <OptionGroup label="Richtung">
            <SegmentedControl label="Richtung" options={DIRECTION_OPTIONS} value={defaults.direction} onChange={(direction) => set({ direction })} fill />
          </OptionGroup>
          <OptionGroup label="Wiederholen">
            <SegmentedControl label="Wiederholen" options={LOOP_OPTIONS} value={defaults.loop ? 'loop' : 'once'} onChange={(v) => set({ loop: v === 'loop' })} fill />
          </OptionGroup>
        </fieldset>
      </div>

      <div className="preferences__footer">
        <Button variant="ghost" disabled={same(defaults, FACTORY_WORK_DEFAULTS)} onClick={() => onChange(FACTORY_WORK_DEFAULTS)}>
          Auf Standard zurücksetzen
        </Button>
      </div>
    </section>
  );
}
