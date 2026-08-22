import { checkPatRateLimit } from "@/lib/auth/rate-limit";
import { consumeAuthorizationCode } from "@/lib/oauth/authorize";
import { lookupClientName } from "@/lib/oauth/clients";
import { verifyPkceS256 } from "@/lib/oauth/crypto";
import { mintTokenPair, rotateRefreshToken, type TokenPair } from "@/lib/oauth/tokens";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

function tokenResponse(pair: TokenPair): Response {
  return Response.json(
    {
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: pair.scopes.join(" "),
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value ? value : undefined;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: Request) {
  const limited = checkPatRateLimit(`oauth-token:${clientIp(req)}`);
  if (limited.limited) {
    return Response.json(
      { error: "slow_down", error_description: "Too many token requests." },
      {
        status: 429,
        headers: { ...CORS_HEADERS, "Retry-After": String(limited.retryAfterSeconds) },
      },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded.");
  }

  const grantType = formString(form, "grant_type");

  if (grantType === "authorization_code") {
    const code = formString(form, "code");
    const verifier = formString(form, "code_verifier");
    const clientId = formString(form, "client_id");
    const redirectUri = formString(form, "redirect_uri");
    if (!code || !verifier) {
      return oauthError("invalid_request", "code and code_verifier are required.");
    }

    // Single-use: the code is consumed before any other check, so a failed
    // exchange burns it rather than leaving it retryable.
    const consumed = await consumeAuthorizationCode(code);
    if (!consumed) return oauthError("invalid_grant", "Unknown or already used authorization code.");
    if (consumed.expired) return oauthError("invalid_grant", "Authorization code has expired.");
    if (!clientId || clientId !== consumed.clientId) {
      return oauthError("invalid_grant", "client_id does not match the authorization code.");
    }
    if (!redirectUri || redirectUri !== consumed.redirectUri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
    if (!verifyPkceS256(verifier, consumed.codeChallenge)) {
      return oauthError("invalid_grant", "PKCE verification failed.");
    }

    const clientName = await lookupClientName(consumed.clientId);
    const pair = await mintTokenPair({
      userId: consumed.userId,
      clientId: consumed.clientId,
      clientName,
      scopes: consumed.scopes,
    });
    return tokenResponse(pair);
  }

  if (grantType === "refresh_token") {
    const refreshToken = formString(form, "refresh_token");
    if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.");

    const result = await rotateRefreshToken(refreshToken, formString(form, "client_id"));
    if (!result.ok) return oauthError(result.error, result.description);
    return tokenResponse(result.pair);
  }

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types: authorization_code, refresh_token.",
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
