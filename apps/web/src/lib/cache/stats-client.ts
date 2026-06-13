import "server-only";

/** Service role is required for cross-request caches; optional in local dev. */
export function canUseServiceClient(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
