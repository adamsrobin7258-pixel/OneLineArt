import { useEffect, useRef } from 'react';
import { backStack } from './backStack';

/** While `active`, the system back action calls `handler` (instead of navigating). */
export function useBackHandler(active: boolean, handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => (active ? backStack.push(() => latest.current()) : undefined), [active]);
}
