import { useEffect, useMemo, useRef } from 'react';

/**
 * Returns a stable debounced version of `callback`.
 *
 * Calling `debounce()` directly inside a component body creates a brand new
 * timer on every render, which means the previous timer is never cleared and
 * the debounce silently does nothing. This hook keeps one timer for the
 * lifetime of the component and always invokes the latest callback.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay = 300
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Always point at the freshest callback without resetting the timer.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Clear any pending timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useMemo(() => {
    return (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    };
  }, [delay]);
}

export default useDebouncedCallback;
