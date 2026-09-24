import { SPEED_PRESETS, type AnimationDirection } from '../core';
import { Button } from '../ui/components/Button';
import { OptionGroup } from '../ui/components/OptionGroup';
import { SegmentedControl } from '../ui/components/SegmentedControl';
import type { AnimationChoice } from './state/useProjects';

const SPEED_OPTIONS = SPEED_PRESETS.map((v) => ({ value: String(v), label: `${String(v).replace('.', ',')}×` }));
const DIRECTION_OPTIONS: readonly { value: AnimationDirection; label: string }[] = [
  { value: 'forward', label: 'Vorwärts' },
  { value: 'reverse', label: 'Rückwärts' },
];
const LOOP_OPTIONS = [
  { value: 'once', label: 'Einmal' },
  { value: 'loop', label: 'Endlos' },
] as const;
const DIRECTION_HINTS: Record<AnimationDirection, string> = {
  forward: 'In der Reihenfolge der Linie',
  reverse: 'Vom Ende der Linie zum Anfang',
};

interface PlaybackPanelProps {
  id: string;
  animation: Required<AnimationChoice>;
  onChange: (patch: Partial<AnimationChoice>) => void;
  /** Start point selection on the image is active. */
  picking: boolean;
  onPick: () => void;
  /** Distance of the chosen point from the line (path px), null without a start point. */
  startDistance: number | null;
}

/**
 * "Wiedergabe": speed, direction, repetition and start point of the drawing process.
 * All of it only changes how the SAME line is played back — never the line.
 */
export function PlaybackPanel({ id, animation, onChange, picking, onPick, startDistance }: PlaybackPanelProps) {
  const custom = animation.startPoint !== null;
  return (
    <section id={id} className="adjust playback" aria-label="Wiedergabe" data-testid="playback-panel">
      <div className="adjust__group">
        {/* While choosing the start point only that choice is shown: the image gets the room (phones). */}
        {!picking && (
          <>
            <OptionGroup label="Geschwindigkeit" caption={animation.speed === 1 ? 'Normal' : animation.speed < 1 ? 'Langsamer' : 'Schneller'}>
              <SegmentedControl label="Geschwindigkeit" options={SPEED_OPTIONS} value={String(animation.speed)} onChange={(v) => onChange({ speed: Number(v) })} fill />
            </OptionGroup>
            <OptionGroup label="Richtung" caption={DIRECTION_HINTS[animation.direction]}>
              <SegmentedControl label="Richtung" options={DIRECTION_OPTIONS} value={animation.direction} onChange={(direction) => onChange({ direction })} fill />
            </OptionGroup>
            <OptionGroup label="Wiederholen" caption={animation.loop ? 'Beginnt nach dem Standbild von vorn (nur Vorschau)' : 'Endet mit dem fertigen Bild'}>
              <SegmentedControl label="Wiederholen" options={LOOP_OPTIONS} value={animation.loop ? 'loop' : 'once'} onChange={(v) => onChange({ loop: v === 'loop' })} fill />
            </OptionGroup>
          </>
        )}
        <OptionGroup
          label="Startpunkt"
          caption={
            picking
              ? 'Tippe auf das Bild'
              : custom
                ? startDistance !== null && startDistance > 0.5
                  ? 'Beginnt am nächstgelegenen Punkt der Linie'
                  : 'Eigener Startpunkt'
                : 'Standard: Anfang der Linie'
          }
        >
          <div className="playback__start">
            <Button variant={picking ? 'primary' : 'quiet'} aria-pressed={picking} onClick={onPick}>
              {picking ? 'Auswahl abbrechen' : 'Startpunkt setzen'}
            </Button>
            <Button variant="ghost" disabled={!custom || picking} onClick={() => onChange({ startPoint: null })}>
              Zurücksetzen
            </Button>
          </div>
        </OptionGroup>
      </div>
    </section>
  );
}
