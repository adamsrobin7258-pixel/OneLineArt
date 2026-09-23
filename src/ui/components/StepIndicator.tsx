import { Icon } from './Icon';

interface Step {
  readonly id: string;
  readonly label: string;
}

interface StepIndicatorProps<T extends string> {
  steps: readonly (Step & { readonly id: T })[];
  current: T;
  /** Steps the user can go to now; the others are shown but inert. */
  reachable: ReadonlySet<T>;
  onSelect: (id: T) => void;
}

/**
 * Progress through the flow. Done steps show a check and can be revisited,
 * the current step is emphasised, later steps stay quiet until reachable.
 * Step numbers come from a CSS counter (not part of the accessible name).
 * On narrow screens a compact "Schritt n von m" with a segment bar is shown.
 */
export function StepIndicator<T extends string>({ steps, current, reachable, onSelect }: StepIndicatorProps<T>) {
  const index = steps.findIndex((s) => s.id === current);
  return (
    <nav className="steps" aria-label="Ablauf">
      <ol className="steps__list">
        {steps.map((step, i) => {
          const isCurrent = step.id === current;
          const done = i < index;
          const canGo = reachable.has(step.id) && !isCurrent;
          const state = isCurrent ? 'is-current' : done ? 'is-done' : 'is-upcoming';
          return (
            <li key={step.id} className={`steps__item ${state}${reachable.has(step.id) ? '' : ' is-unavailable'}`} aria-current={isCurrent ? 'step' : undefined} aria-disabled={reachable.has(step.id) ? undefined : true}>
              {canGo ? (
                <button type="button" className="steps__link" onClick={() => onSelect(step.id)}>
                  <span className="steps__marker" aria-hidden="true">
                    {done && <Icon name="check" size={12} />}
                  </span>
                  {step.label}
                </button>
              ) : (
                <span className="steps__link">
                  <span className="steps__marker" aria-hidden="true">
                    {done && <Icon name="check" size={12} />}
                  </span>
                  {step.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="steps__compact" aria-hidden="true">
        <span>
          Schritt {index + 1} von {steps.length} · <strong>{steps[index]?.label}</strong>
        </span>
        <span className="steps__bar">
          {steps.map((step, i) => (
            <span key={step.id} className={i <= index ? 'is-filled' : ''} />
          ))}
        </span>
      </div>
    </nav>
  );
}
