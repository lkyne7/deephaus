import { createHash, randomBytes } from "node:crypto";
import { getEffectivePlan } from "@/lib/billing/access";
import { createServiceClient } from "@/lib/supabase/server";

export const API_TOKEN_PREFIX = "dh_";

export type ApiTokenRow = {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX) && token.length > API_TOKEN_PREFIX.length + 16;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const token = `${API_TOKEN_PREFIX}${secret}`;
  const prefix = token.slice(0, 12);
  return { token, prefix, hash: hashApiToken(token) };
}

export async function verifyApiToken(
  token: string,
): Promise<{ userId: string; tokenId: string; scopes: string[] } | null> {
  if (!isApiToken(token)) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, user_id, scopes")
    .eq("token_hash", hashApiToken(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  if ((await getEffectivePlan(data.user_id)) !== "pro") return null;

  void supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    userId: data.user_id,
    tokenId: data.id,
    scopes: (data.scopes as string[] | null) ?? ["study"],
  };
}

export function tokenHasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope) || scopes.includes("*");
}
