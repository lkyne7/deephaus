import { createServiceClient } from "@/lib/supabase/server";

export type ResolvedClient = {
  /** Dynamically registered public client UUID. */
  clientId: string;
  clientName: string;
  logoUri: string | null;
  redirectUris: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname);
}

/** Redirect URIs a public client may register: https, loopback http, or a custom app scheme (e.g. cursor://). */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (raw !== raw.trim() || url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopbackUrl(url);
  // Custom schemes (reverse-DNS app callbacks) are permitted for native apps.
  return url.protocol === "cursor:" || /^[a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+:$/.test(url.protocol);
}

/**
 * OAuth 2.1 exact-match comparison, except loopback redirect URIs where the
 * port may vary between runs (RFC 8252 §7.3).
 */
export function redirectUriMatches(registered: string, provided: string): boolean {
  if (registered === provided) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(provided);
  } catch {
    return false;
  }
  return (
    isLoopbackUrl(a) &&
    isLoopbackUrl(b) &&
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    a.hash === b.hash &&
    a.username === b.username &&
    a.password === b.password
  );
}

async function resolveDcrClient(clientId: string): Promise<ResolvedClient | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris, logo_uri")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    clientId: data.client_id as string,
    clientName: data.client_name as string,
    logoUri: (data.logo_uri as string | null) ?? null,
    redirectUris: (data.redirect_uris as string[]) ?? [],
  };
}

/** DCR only: never fetch a URL supplied as a client_id. */
export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (UUID_RE.test(clientId)) return resolveDcrClient(clientId);
  return null;
}

/**
 * Display name for token rows. Avoids re-fetching CIMD documents at token
 * time — the URL hostname is good enough for display.
 */
export async function lookupClientName(clientId: string): Promise<string> {
  if (clientId.startsWith("https://")) {
    try {
      return new URL(clientId).hostname;
    } catch {
      return "MCP client";
    }
  }
  const client = UUID_RE.test(clientId) ? await resolveDcrClient(clientId) : null;
  return client?.clientName ?? "MCP client";
}
