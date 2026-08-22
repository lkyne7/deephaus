import { generateApiToken } from "@/lib/auth/api-token";
import { generateOpaqueSecret, sha256Hex } from "@/lib/oauth/crypto";
import { createServiceClient } from "@/lib/supabase/server";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h — refresh token handles longevity
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // ~90d

export type TokenPair = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  scopes: string[];
};

/**
 * Mint an OAuth access token (a regular dh_ row in api_tokens, so the existing
 * verification/Pro-gate/rate-limit path applies) plus a rotating refresh token.
 */
export async function mintTokenPair(input: {
  userId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
}): Promise<TokenPair> {
  const supabase = createServiceClient();

  const access = generateApiToken();
  const { data: tokenRow, error: tokenError } = await supabase
    .from("api_tokens")
    .insert({
      user_id: input.userId,
      name: input.clientName,
      token_prefix: access.prefix,
      token_hash: access.hash,
      scopes: input.scopes,
      kind: "oauth",
      client_id: input.clientId,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (tokenError || !tokenRow) {
    throw new Error(`Failed to mint access token: ${tokenError?.message ?? "no row"}`);
  }

  const refresh = generateOpaqueSecret("dhr_");
  const { error: refreshError } = await supabase.from("oauth_refresh_tokens").insert({
    token_hash: refresh.hash,
    user_id: input.userId,
    client_id: input.clientId,
    client_name: input.clientName,
    scopes: input.scopes,
    api_token_id: tokenRow.id,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  if (refreshError) {
    // Don't leave an orphaned access token behind.
    await supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenRow.id);
    throw new Error(`Failed to mint refresh token: ${refreshError.message}`);
  }

  return {
    accessToken: access.token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.secret,
    scopes: input.scopes,
  };
}

/** Revoke every grant (refresh tokens + access-token rows) for a user+client pair. */
export async function revokeGrantFamily(userId: string, clientId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase
    .from("oauth_refresh_tokens")
    .update({ revoked_at: now })
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .is("revoked_at", null);
  await supabase
    .from("api_tokens")
    .update({ revoked_at: now })
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .eq("kind", "oauth")
    .is("revoked_at", null);
}

export type RotateResult = { ok: true; pair: TokenPair } | { ok: false; error: "invalid_grant"; description: string };

/**
 * Refresh-token rotation: revoke the presented token and its access token,
 * issue a fresh pair. Presenting an already-rotated token is treated as theft
 * and revokes the whole user+client family (OAuth 2.1 §4.3.1 guidance).
 */
export async function rotateRefreshToken(refreshToken: string, clientId?: string): Promise<RotateResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_refresh_tokens")
    .select("id, user_id, client_id, client_name, scopes, api_token_id, expires_at, revoked_at")
    .eq("token_hash", sha256Hex(refreshToken))
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "invalid_grant", description: "Unknown refresh token." };
  }
  if (clientId && clientId !== data.client_id) {
    return { ok: false, error: "invalid_grant", description: "client_id does not match this refresh token." };
  }
  if (data.revoked_at) {
    await revokeGrantFamily(data.user_id as string, data.client_id as string);
    return { ok: false, error: "invalid_grant", description: "Refresh token has been revoked." };
  }
  if (new Date(data.expires_at as string).getTime() <= Date.now()) {
    return { ok: false, error: "invalid_grant", description: "Refresh token has expired." };
  }

  const now = new Date().toISOString();
  // Atomic claim: only one concurrent request can rotate this token.
  const { data: claimed } = await supabase
    .from("oauth_refresh_tokens")
    .update({ revoked_at: now })
    .eq("id", data.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    await revokeGrantFamily(data.user_id as string, data.client_id as string);
    return { ok: false, error: "invalid_grant", description: "Refresh token has been revoked." };
  }
  if (data.api_token_id) {
    await supabase.from("api_tokens").update({ revoked_at: now }).eq("id", data.api_token_id);
  }

  const pair = await mintTokenPair({
    userId: data.user_id as string,
    clientId: data.client_id as string,
    clientName: data.client_name as string,
    scopes: (data.scopes as string[]) ?? [],
  });
  return { ok: true, pair };
}
