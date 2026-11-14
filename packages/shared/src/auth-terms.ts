type TermsUser = { user_metadata?: Record<string, unknown> | null } | null | undefined;
type TermsClient = {
  auth: { updateUser: (attributes: { data: Record<string, string> }) => Promise<{ error: unknown }> };
};

/**
 * Apple, Google and email-code accounts are created by continuing past the
 * consent line, so the acceptance time is stored on first sign-in when the
 * account doesn't have one yet. Never blocks sign-in.
 */
export async function recordTermsAcceptance(client: TermsClient, user: TermsUser, now = new Date()): Promise<void> {
  if (!user || user.user_metadata?.terms_accepted_at) return;
  try {
    await client.auth.updateUser({ data: { terms_accepted_at: now.toISOString() } });
  } catch {
    // Best effort.
  }
}
