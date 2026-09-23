import type { ReactNode } from 'react';

interface StatusPanelProps {
  title: string;
  detail?: string;
  busy?: boolean;
  children?: ReactNode;
}

/** Centered status for loading, processing and errors. */
export function StatusPanel({ title, detail, busy = false, children }: StatusPanelProps) {
  return (
    <div className="status" role={busy ? 'status' : 'alert'} aria-live="polite" aria-busy={busy}>
      {busy && <div className="status__progress" aria-hidden="true" />}
      <p className="status__title">{title}</p>
      {detail && <p className="status__detail">{detail}</p>}
      {children && <div className="status__actions">{children}</div>}
    </div>
  );
}
