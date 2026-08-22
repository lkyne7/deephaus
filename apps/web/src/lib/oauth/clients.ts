import { createServiceClient } from "@/lib/supabase/server";

export type ResolvedClient = {
  /** DCR uuid or CIMD https URL — stored verbatim on codes/tokens. */
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
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopbackUrl(url);
  // Custom schemes (reverse-DNS app callbacks) are permitted for native apps.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol !== "javascript:" && url.protocol !== "data:";
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
    a.pathname === b.pathname
  );
}

/**
 * Client ID Metadata Document: the client_id IS an https URL pointing at a
 * JSON doc describing the client. Fetched live, never stored.
 */
async function resolveCimdClient(clientIdUrl: string): Promise<ResolvedClient | null> {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return null;
  }
  // https only, no fragments, and never loopback/IP literals (SSRF guard).
  if (url.protocol !== "https:" || url.hash) return null;
  if (LOOPBACK_HOSTS.has(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;

  let doc: unknown;
  try {
    const res = await fetch(clientIdUrl, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    doc = await res.json();
  } catch {
    return null;
  }

  if (typeof doc !== "object" || doc === null) return null;
  const meta = doc as Record<string, unknown>;
  // The document must claim the exact URL it was fetched from.
  if (meta.client_id !== clientIdUrl) return null;

  const redirectUris = Array.isArray(meta.redirect_uris)
    ? meta.redirect_uris.filter((u): u is string => typeof u === "string" && isAllowedRedirectUri(u))
    : [];
  if (redirectUris.length === 0) return null;

  return {
    clientId: clientIdUrl,
    clientName: typeof meta.client_name === "string" && meta.client_name.trim() ? meta.client_name.trim().slice(0, 120) : url.hostname,
    logoUri: typeof meta.logo_uri === "string" ? meta.logo_uri : null,
    redirectUris,
  };
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

/** Resolve a client_id: https URL → CIMD document fetch; uuid → DCR registration lookup. */
export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (clientId.startsWith("https://")) return resolveCimdClient(clientId);
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
