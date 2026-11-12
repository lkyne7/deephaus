/**
 * Email sign-in by one-time code. The same email works on any device, unlike
 * a link that only opens the app on the phone it was requested from.
 * The length is a Supabase project setting between 6 and 10 digits.
 */
export const EMAIL_CODE_MIN_LENGTH = 6;
export const EMAIL_CODE_MAX_LENGTH = 10;
/** Supabase refuses a second code for the same address within a minute. */
export const EMAIL_CODE_RESEND_SECONDS = 60;

/**
 * Digits only, so pasted codes with spaces or dashes still work. iOS code
 * autofill sometimes inserts the code twice; no real code is longer than the
 * maximum, so a value that is one code repeated is taken as that code.
 */
export function normalizeEmailCode(input: string): string {
  const digits = input.replace(/\D/g, "");
  const half = digits.length / 2;
  if (
    digits.length > EMAIL_CODE_MAX_LENGTH &&
    Number.isInteger(half) &&
    half >= EMAIL_CODE_MIN_LENGTH &&
    digits.slice(0, half) === digits.slice(half)
  ) {
    return digits.slice(0, half);
  }
  return digits.slice(0, EMAIL_CODE_MAX_LENGTH);
}

export function isCompleteEmailCode(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= EMAIL_CODE_MIN_LENGTH && code.length <= EMAIL_CODE_MAX_LENGTH;
}

/** Shown under every sign-in and sign-up option; continuing is the agreement. */
export const AUTH_CONSENT_TEXT = "By continuing, you confirm you're 13 or older and agree to the Terms and Privacy Policy.";

/** Metadata stored on a new account, which records when the terms were accepted. */
export function newAccountMetadata(name?: string | null, now = new Date()): Record<string, string> {
  const trimmed = name?.trim().slice(0, 80);
  return {
    terms_accepted_at: now.toISOString(),
    ...(trimmed ? { full_name: trimmed, name: trimmed } : {}),
  };
}

/** Friendlier wording for the errors people hit while using a code. */
export function friendlyEmailCodeError(message: string): string {
  if (/expired|invalid|not found/i.test(message) && /token|otp|code|link/i.test(message)) {
    return "That code is wrong or has expired. Check the latest email, or send a new code.";
  }
  // Supabase's cap on emails per hour, not the one-minute wait between codes.
  if (/email rate limit/i.test(message)) {
    return "Too many sign-in emails were sent recently. Try again later, or continue with Apple or Google.";
  }
  if (/for security purposes|only request this after/i.test(message)) {
    return "A code was just sent. Wait a minute before asking for another.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many attempts. Wait a few minutes, then try again.";
  }
  if (/signups not allowed|user not found/i.test(message)) {
    return "There's no account with that email yet. Create one instead.";
  }
  return message;
}
