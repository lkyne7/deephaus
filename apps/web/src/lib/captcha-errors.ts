/** Shown when the Turnstile widget reports an error; it keeps retrying on its own. */
export const CAPTCHA_WIDGET_FAILED =
  "The security check didn't finish and is retrying. You can still continue.";

/**
 * Supabase Auth rejects a missing or failed Turnstile token with a message like
 * "captcha protection: request disallowed (captcha verification process failed)".
 * Show people something they can act on instead.
 */
export function friendlyAuthError(message: string): string {
  if (/captcha/i.test(message)) {
    return "The security check didn't pass. Wait for it to finish (or tick the box), then try again. If it keeps failing, try another browser.";
  }
  return message;
}
