/** Minimum length for any new password. Existing shorter passwords can still sign in. */
export const MIN_PASSWORD_LENGTH = 8;

type AuthUser = {
  created_at: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string };
};

// Covers the hop from provider or email link back to the app, including the
// desktop shell returning from the system browser.
const FIRST_SIGN_IN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether this session is the account's first. Supabase has no new-user flag
 * on the session, so compare the latest sign-in with the moment the account
 * became usable: a returning user's sign-in is later than that by far.
 */
export function isFirstSignIn(user: AuthUser): boolean {
  if (!user.last_sign_in_at) return true;
  const usableAt = Date.parse(user.email_confirmed_at ?? user.created_at);
  const elapsed = Date.parse(user.last_sign_in_at) - usableAt;
  return Math.abs(elapsed) < FIRST_SIGN_IN_WINDOW_MS;
}

/** Analytics method for a signup: "password", "google", or "apple". */
export function signupMethod(user: AuthUser): string {
  const provider = user.app_metadata?.provider;
  return !provider || provider === "email" ? "password" : provider;
}
