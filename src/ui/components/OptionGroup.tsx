import type { ReactNode } from 'react';

interface OptionGroupProps {
  /** Visible heading of the choice (the control carries its own accessible name). */
  label: string;
  /** Short explanation of the current selection. */
  caption?: string | undefined;
  children: ReactNode;
}

/** A labelled choice with a one-line explanation below it. */
export function OptionGroup({ label, caption, children }: OptionGroupProps) {
  return (
    <div className="option">
      <span className="option__label" aria-hidden="true">
        {label}
      </span>
      {children}
      {caption && (
        <span className="option__caption" aria-live="polite">
          {caption}
        </span>
      )}
    </div>
  );
}
