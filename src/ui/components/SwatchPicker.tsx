import { useRef, type KeyboardEvent } from 'react';

export interface Swatch {
  readonly value: string;
  readonly label: string;
  readonly colors: readonly string[];
}

interface SwatchPickerProps {
  label: string;
  options: readonly Swatch[];
  /** null = none of the options (e.g. own colours). */
  value: string | null;
  onChange: (value: string) => void;
}

/** Colour swatches with radio semantics (arrow keys); each shows its colours as a band. */
export function SwatchPicker({ label, options, value, onChange }: SwatchPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (Math.max(0, index) + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className="swatches" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          tabIndex={o.value === value || (index < 0 && i === 0) ? 0 : -1}
          className={`swatch${o.value === value ? ' is-selected' : ''}`}
          style={{ background: `linear-gradient(to right, ${o.colors.join(', ')})` }}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}
