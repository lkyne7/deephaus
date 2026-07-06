import { useEffect } from "react";

/** How long finished bottom-right toasts stay visible before auto-dismissing. */
export const TOAST_AUTO_DISMISS_MS = 6_000;

export function useAutoDismiss(
  onDismiss: () => void,
  enabled: boolean,
  /** Bump when the toast content changes so the timer restarts. */
  resetKey?: string | number | null,
  delayMs = TOAST_AUTO_DISMISS_MS,
) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(onDismiss, delayMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, enabled, resetKey, delayMs]);
}
