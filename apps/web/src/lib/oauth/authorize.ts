import { API_TOKEN_SCOPES } from "@/lib/auth/api-token";
import { generateOpaqueSecret, sha256Hex } from "@/lib/oauth/crypto";
import { redirectUriMatches, resolveClient, type ResolvedClient } from "@/lib/oauth/clients";
import { createServiceClient } from "@/lib/supabase/server";

const CODE_TTL_MS = 60_000;

export type AuthorizeParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
};

export type ValidAuthorizeRequest = {
  client: ResolvedClient;
  redirectUri: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string;
};

export type AuthorizeValidation =
  | { status: "valid"; request: ValidAuthorizeRequest }
  /** Client or redirect_uri could not be trusted — render an error, never redirect. */
  | { status: "fatal"; error: string; description: string }
  /** Trusted redirect target, bad request otherwise — bounce back with an error code. */
  | { status: "redirect_error"; redirectUri: string; state: string | null; error: string; description: string };

export function parseScopes(scope: string | undefined): string[] | null {
  const requested = (scope ?? "").split(/\s+/).filter(Boolean);
  if (requested.length === 0) return [...API_TOKEN_SCOPES];
  const valid = requested.every((s) => (API_TOKEN_SCOPES as readonly string[]).includes(s));
  return valid ? [...new Set(requested)] : null;
}

export async function validateAuthorizeRequest(params: AuthorizeParams): Promise<AuthorizeValidation> {
  const clientId = params.client_id?.trim();
  if (!clientId) {
    return { status: "fatal", error: "invalid_request", description: "Missing client_id." };
  }

  const client = await resolveClient(clientId);
  if (!client) {
    return { status: "fatal", error: "invalid_client", description: "Unknown or invalid client_id." };
  }

  const redirectUri = params.redirect_uri?.trim();
  if (!redirectUri || !client.redirectUris.some((r) => redirectUriMatches(r, redirectUri))) {
    return {
      status: "fatal",
      error: "invalid_request",
      description: "redirect_uri is not registered for this client.",
    };
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    status: "redirect_error",
    redirectUri,
    state,
    error,
    description,
  });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (!params.code_challenge) {
    return fail("invalid_request", "PKCE code_challenge is required.");
  }
  if ((params.code_challenge_method ?? "S256") !== "S256") {
    return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  }

  const scopes = parseScopes(params.scope);
  if (!scopes) {
    return fail("invalid_scope", `Supported scopes: ${API_TOKEN_SCOPES.join(", ")}.`);
  }

  return {
    status: "valid",
    request: {
      client,
      redirectUri,
      scopes,
      state,
      codeChallenge: params.code_challenge,
    },
  };
}

/** Mint a single-use authorization code (hash stored, plaintext returned for the redirect). */
export async function issueAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
}): Promise<string> {
  const { secret, hash } = generateOpaqueSecret("dhc_");
  const supabase = createServiceClient();
  const { error } = await supabase.from("oauth_codes").insert({
    code_hash: hash,
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    scopes: input.scopes,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Failed to issue authorization code: ${error.message}`);
  return secret;
}

export type ConsumedCode = {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  expired: boolean;
};

/** Atomically consume a code (single use). Returns null if unknown or already consumed. */
export async function consumeAuthorizationCode(code: string): Promise<ConsumedCode | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", sha256Hex(code))
    .is("consumed_at", null)
    .select("client_id, user_id, redirect_uri, scopes, code_challenge, expires_at")
    .maybeSingle();
  if (error || !data) return null;
  return {
    clientId: data.client_id as string,
    userId: data.user_id as string,
    redirectUri: data.redirect_uri as string,
    scopes: (data.scopes as string[]) ?? [],
    codeChallenge: data.code_challenge as string,
    expired: new Date(data.expires_at as string).getTime() <= Date.now(),
  };
}
