// FSRS scheduling logic lives in @deephaus/scheduling so web, mobile, and
// desktop can grade cards locally (offline) with identical behavior. This
// module re-exports it and keeps the server-only param loading helper.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FSRS_PARAM_COUNT } from "@deephaus/scheduling";

export * from "@deephaus/scheduling";

const PARAMS_CACHE_TTL_MS = 60_000;
const paramsCache = new Map<string, { value: number[] | undefined; expiresAt: number }>();

/**
 * Load the user's personalized FSRS weights, falling back to ts-fsrs defaults
 * when no optimization has run yet. Validates the param length so a future
 * algorithm version doesn't silently feed wrongly-shaped weights into FSRS.
 */
export async function loadUserParams(
  supabase: SupabaseClient,
  userId: string,
): Promise<number[] | undefined> {
  const cached = paramsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data } = await supabase
    .from("user_fsrs_params")
    .select("params")
    .eq("user_id", userId)
    .maybeSingle();
  const params = data?.params as number[] | undefined;
  const value =
    !params || params.length !== FSRS_PARAM_COUNT ? undefined : params;
  paramsCache.set(userId, { value, expiresAt: Date.now() + PARAMS_CACHE_TTL_MS });
  return value;
}
