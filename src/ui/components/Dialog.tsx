import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBackHandler } from '../useBackHandler';

interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Action buttons (cancel first, confirming action last). */
  actions: ReactNode;
  /** Escape / backdrop: same as cancelling. */
  onClose: () => void;
}

/**
 * Modal confirmation built on the native <dialog>: focus is trapped, the page
 * behind is inert, Escape closes it. Used for anything destructive.
 */
export function Dialog({ open, title, children, actions, onClose }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The Android back button closes the dialog first.
  useBackHandler(open, onClose);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (outside the panel) cancels.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog__panel">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          {children && <div className="dialog__body">{children}</div>}
          <div className="dialog__actions">{actions}</div>
        </div>
      )}
    </dialog>
  );
}
