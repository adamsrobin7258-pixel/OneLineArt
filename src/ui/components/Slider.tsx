import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Visible and announced value text. */
  format: (value: number) => string;
  /** Live updates while dragging (cheap, render-only changes). */
  onChange?: (value: number) => void;
  /** Final value when the drag or key press ends (expensive changes, e.g. a new path). */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  /** Short explanation below the slider. */
  hint?: string | undefined;
}

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Labelled range input (native semantics: role slider, arrow keys, aria-valuetext). While dragging it shows its own value; the committed value comes from outside. */
export function Slider({ label, value, min, max, step, format, onChange, onCommit, disabled = false, hint }: SliderProps) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit?.(draft);
  };
  return (
    <div className={`slider${disabled ? ' is-disabled' : ''}`}>
      <span className="slider__head">
        <label className="slider__label" htmlFor={id}>
          {label}
        </label>
        <output className="slider__value" htmlFor={id} aria-hidden="true">
          {format(shown)}
        </output>
      </span>
      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-valuetext={format(shown)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          setDraft(next);
          onChange?.(next);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={(event: KeyboardEvent) => {
          if (COMMIT_KEYS.has(event.key)) commit();
        }}
        onBlur={commit}
      />
      {hint && (
        <span id={`${id}-hint`} className="slider__hint">
          {hint}
        </span>
      )}
    </div>
  );
}
