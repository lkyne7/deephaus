import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminConfig = {
  url: string;
  key: string;
  keyKind: string;
};

function decodeJwtPayload(token: string): { role?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as { role?: string };
  } catch {
    return null;
  }
}

/** Safe label for logs — never includes secret material. */
export function describeSupabaseKey(key: string): string {
  if (key.startsWith("sb_secret_")) return "secret API key (sb_secret_…)";
  if (key.startsWith("sb_publishable_")) return "publishable API key (sb_publishable_…)";
  const payload = decodeJwtPayload(key);
  if (payload?.role === "service_role") return "legacy service_role JWT";
  if (payload?.role === "anon") return "legacy anon JWT";
  if (payload?.role) return `legacy JWT (role=${payload.role})`;
  return "unrecognized key format";
}

export function resolveSupabaseAdminConfig(): SupabaseAdminConfig {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  )?.trim();

  if (!url) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  }
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). " +
        "Set this in the Render dashboard — use the service_role / secret key from " +
        "Supabase → Project Settings → API, not the anon / publishable key.",
    );
  }

  const keyKind = describeSupabaseKey(key);
  if (key.startsWith("sb_publishable_") || decodeJwtPayload(key)?.role === "anon") {
    throw new Error(
      `Refusing to start: configured key is a client-side ${keyKind}. ` +
        "The worker needs the elevated service_role JWT or sb_secret_… key.",
    );
  }

  return { url, key, keyKind };
}

/** Fail fast with a actionable message when credentials are wrong. */
export async function assertSupabaseAdminAccess(
  supabase: SupabaseClient,
  config: SupabaseAdminConfig,
): Promise<void> {
  const { error } = await supabase.rpc("claim_anki_import_job");
  if (!error) return;

  const msg = error.message ?? String(error);
  if (/invalid api key/i.test(msg)) {
    throw new Error(
      `Supabase rejected the API key for ${config.url} (${config.keyKind}). ` +
        "In Render → deephaus-anki-worker → Environment, set SUPABASE_SERVICE_ROLE_KEY to " +
        "the service_role secret from Supabase → Project Settings → API. " +
        "Use Legacy → service_role, or API Keys → default secret (sb_secret_…). " +
        "Do not use anon / publishable. Re-deploy after saving.",
    );
  }

  throw new Error(`Supabase connection check failed (${config.url}): ${msg}`);
}
