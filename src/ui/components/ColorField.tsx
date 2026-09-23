import { useId, useState } from 'react';

interface ColorFieldProps {
  label: string;
  /** '#rrggbb' */
  value: string;
  onChange: (color: string) => void;
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

const normalize = (text: string): string | null => {
  const m = HEX.exec(text.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${hex.toLowerCase()}`;
};

/** Colour choice: the platform's colour picker plus a hex field (works where no picker exists). */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const color = normalize(text);
    setText(null);
    if (color && color !== value) onChange(color);
  };
  return (
    <div className="color-field">
      <label className="slider__label" htmlFor={`${id}-hex`}>
        {label}
      </label>
      <div className="color-field__row">
        <input
          type="color"
          className="color-field__swatch"
          value={value.length === 7 ? value : '#000000'}
          aria-label={`${label} wählen`}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <input
          id={`${id}-hex`}
          className="color-field__hex"
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={text ?? value}
          aria-invalid={text !== null && normalize(text) === null}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      </div>
    </div>
  );
}
