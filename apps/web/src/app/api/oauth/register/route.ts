import { checkPatRateLimit } from "@/lib/auth/rate-limit";
import { isAllowedRedirectUri } from "@/lib/oauth/clients";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-protocol-version",
};

const MAX_REDIRECT_URIS = 10;

function registrationError(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status: 400, headers: CORS_HEADERS },
  );
}

/** RFC 7591 Dynamic Client Registration — public clients only, no secret issued. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = checkPatRateLimit(`oauth-register:${ip}`);
  if (limited.limited) {
    return Response.json(
      { error: "slow_down", error_description: "Too many registration requests." },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return registrationError("invalid_client_metadata", "Body must be JSON.");
  }
  if (typeof body !== "object" || body === null) {
    return registrationError("invalid_client_metadata", "Body must be a JSON object.");
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = Array.isArray(meta.redirect_uris)
    ? meta.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return registrationError(
      "invalid_redirect_uri",
      `redirect_uris must contain 1-${MAX_REDIRECT_URIS} entries.`,
    );
  }
  const invalid = redirectUris.find((u) => !isAllowedRedirectUri(u));
  if (invalid) {
    return registrationError(
      "invalid_redirect_uri",
      `Redirect URIs must be https, loopback http, or an app scheme. Rejected: ${invalid}`,
    );
  }

  const clientName =
    typeof meta.client_name === "string" && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, 120)
      : "MCP client";
  const logoUri =
    typeof meta.logo_uri === "string" && meta.logo_uri.startsWith("https://")
      ? meta.logo_uri.slice(0, 500)
      : null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({ client_name: clientName, redirect_uris: redirectUris, logo_uri: logoUri })
    .select("client_id, created_at")
    .single();
  if (error || !data) {
    return Response.json(
      { error: "server_error", error_description: "Could not register client." },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  return Response.json(
    {
      client_id: data.client_id,
      client_id_issued_at: Math.floor(new Date(data.created_at as string).getTime() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      ...(logoUri ? { logo_uri: logoUri } : {}),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
