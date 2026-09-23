interface Step {
  readonly id: string;
  readonly label: string;
}

interface StepIndicatorProps {
  steps: readonly Step[];
  current: string;
  available: ReadonlySet<string>;
}

/** Quiet progress through the flow. Unavailable steps are shown but inert. */
export function StepIndicator({ steps, current, available }: StepIndicatorProps) {
  const index = steps.findIndex((s) => s.id === current);
  return (
    <nav className="steps" aria-label="Ablauf">
      <ol className="steps__list">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`steps__item${step.id === current ? ' is-current' : ''}${available.has(step.id) ? '' : ' is-unavailable'}`}
            aria-current={step.id === current ? 'step' : undefined}
            aria-disabled={available.has(step.id) ? undefined : true}
          >
            {step.label}
          </li>
        ))}
      </ol>
      <span className="steps__compact">
        {index + 1} / {steps.length} · {steps[index]?.label}
      </span>
    </nav>
  );
}
