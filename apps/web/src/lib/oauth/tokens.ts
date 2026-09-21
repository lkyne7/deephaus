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
  resource: string;
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
      resource: input.resource,
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
    resource: input.resource,
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
  const { error } = await supabase.rpc("revoke_oauth_grant", {
    p_user_id: userId,
    p_client_id: clientId,
  });
  if (error) throw new Error("Could not revoke the OAuth connection.");
}

export type RotateResult = { ok: true; pair: TokenPair } | { ok: false; error: "invalid_grant" | "invalid_scope"; description: string };

/**
 * Refresh-token rotation: revoke the presented token and its access token,
 * issue a fresh pair. Presenting an already-rotated token is treated as theft
 * and revokes the whole user+client family (OAuth 2.1 §4.3.1 guidance).
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
  resource: string,
  requestedScopes?: string[],
): Promise<RotateResult> {
  const access = generateApiToken();
  const refresh = generateOpaqueSecret("dhr_");
  // Rotation and grant revocation share a database transaction lock. A replay
  // cannot race a rotation and leave a newly minted token valid after revocation.
  const { data, error } = await createServiceClient().rpc("rotate_oauth_refresh_token", {
    p_token_hash: sha256Hex(refreshToken),
    p_client_id: clientId,
    p_resource: resource,
    p_scopes: requestedScopes ?? null,
    p_access_hash: access.hash,
    p_access_prefix: access.prefix,
    p_refresh_hash: refresh.hash,
  });
  if (error || !data) throw new Error("Could not refresh the OAuth connection.");
  if (!data.ok) return { ok: false, error: data.error, description: data.description };
  return {
    ok: true,
    pair: {
      accessToken: access.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: refresh.secret,
      scopes: data.scopes,
    },
  };
}
