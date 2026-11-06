const KEY = "deephaus.create.autoSend";

/**
 * Marks a prompt the user just sent from another page, so Create can run it.
 * This stays out of the URL so a shared `/create?prompt=` link can only pre-fill
 * the composer and can't spend anyone's credits.
 */
export function markAutoSend(prompt: string): void {
  try {
    window.sessionStorage.setItem(KEY, prompt);
  } catch {
    // Without storage the prompt still pre-fills, one press away from sending.
  }
}

/** True once for a prompt marked by `markAutoSend`, then clears the mark. */
export function consumeAutoSend(prompt: string): boolean {
  try {
    if (window.sessionStorage.getItem(KEY) !== prompt) return false;
    window.sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
