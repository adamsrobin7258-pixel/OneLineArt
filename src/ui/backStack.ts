/**
 * Things that the system back action should close first (dialogs, a running
 * export), most recent on top. Platform-neutral: the Android back button
 * feeds it; the browser does not use it.
 */
export interface BackStack {
  /** Registers a handler; returns the function that removes it again. */
  push(handler: () => void): () => void;
  /** Runs the top handler; false if there is none. */
  handle(): boolean;
}

export function createBackStack(): BackStack {
  const handlers: (() => void)[] = [];
  return {
    push(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.lastIndexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    handle() {
      const top = handlers[handlers.length - 1];
      if (!top) return false;
      top();
      return true;
    },
  };
}

/** The app's single back stack. */
export const backStack = createBackStack();
