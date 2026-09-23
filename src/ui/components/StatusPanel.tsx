import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface StatusPanelProps {
  title: string;
  detail?: string;
  busy?: boolean;
  children?: ReactNode;
}

/** Centered status for loading, processing and errors (errors get an icon and are announced). */
export function StatusPanel({ title, detail, busy = false, children }: StatusPanelProps) {
  const isError = !busy && !!children;
  return (
    <div className={`status${isError ? ' status--error' : ''}`} role={busy ? 'status' : 'alert'} aria-live="polite" aria-busy={busy}>
      {busy && <div className="status__progress" aria-hidden="true" />}
      {isError && (
        <span className="status__icon">
          <Icon name="alert" size={22} />
        </span>
      )}
      <p className="status__title">{title}</p>
      {detail && <p className="status__detail">{detail}</p>}
      {children && <div className="status__actions">{children}</div>}
    </div>
  );
}
