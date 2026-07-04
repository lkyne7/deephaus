import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

export const NOTION_VERSION = "2026-03-11";
/** httpOnly cookie carrying the OAuth CSRF state + return path. */
export const NOTION_STATE_COOKIE = "notion_oauth_state";
const NOTION_API = "https://api.notion.com/v1";

/** Thrown when the user has no stored Notion connection. */
export class NotionNotConnectedError extends Error {
  constructor() {
    super("Notion is not connected for this account.");
    this.name = "NotionNotConnectedError";
  }
}

/** Thrown when tokens are invalid/revoked and the user must reconnect. */
export class NotionAuthError extends Error {
  constructor(message = "Notion authorization expired. Please reconnect Notion.") {
    super(message);
    this.name = "NotionAuthError";
  }
}

export type NotionConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  bot_id: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_icon: string | null;
};

export function notionConfigured(): boolean {
  return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET);
}

/**
 * OAuth redirect URI registered with Notion. Prefer NOTION_REDIRECT_URI when set
 * (production Vercel env), else NEXT_PUBLIC_APP_URL, else the live request origin
 * (local dev at localhost:3000).
 */
export function notionRedirectUri(origin: string): string {
  const explicit = process.env.NOTION_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/api/notion/callback`;

  return `${origin.replace(/\/$/, "")}/api/notion/callback`;
}

export function notionAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID!,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });
  return `${NOTION_API}/oauth/authorize?${params.toString()}`;
}

export type NotionTokenResponse = {
  access_token: string;
  refresh_token?: string | null;
  bot_id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_icon?: string | null;
};

async function tokenRequest(body: Record<string, string>): Promise<NotionTokenResponse> {
  const basic = Buffer.from(
    `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${NOTION_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (NotionTokenResponse & { error?: string })
    | null;
  if (!res.ok || !data?.access_token) {
    const code = data?.error ?? `HTTP ${res.status}`;
    throw new NotionAuthError(`Notion token request failed (${code}).`);
  }
  return data;
}

export async function exchangeNotionCode(
  code: string,
  redirectUri: string,
): Promise<NotionTokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

/**
 * Token storage. notion_connections has RLS enabled with no policies, so all
 * access goes through the service-role client and tokens never reach clients.
 */
export async function getNotionConnection(userId: string): Promise<NotionConnection | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notion_connections")
    .select("user_id, access_token, refresh_token, bot_id, workspace_id, workspace_name, workspace_icon")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as NotionConnection | null) ?? null;
}

export async function saveNotionConnection(
  userId: string,
  tokens: NotionTokenResponse,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("notion_connections").upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      bot_id: tokens.bot_id ?? null,
      workspace_id: tokens.workspace_id ?? null,
      workspace_name: tokens.workspace_name ?? null,
      workspace_icon: tokens.workspace_icon ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Failed to save Notion connection: ${error.message}`);
}

export async function deleteNotionConnection(userId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("notion_connections").delete().eq("user_id", userId);
}

/**
 * Notion tokens rotate: a refresh returns a brand-new access + refresh token
 * pair and invalidates the old refresh token, so the new pair must be
 * persisted immediately.
 */
async function refreshConnection(connection: NotionConnection): Promise<NotionConnection> {
  if (!connection.refresh_token) throw new NotionAuthError();
  let tokens: NotionTokenResponse;
  try {
    tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    });
  } catch {
    throw new NotionAuthError();
  }
  const merged: NotionTokenResponse = {
    ...tokens,
    bot_id: tokens.bot_id ?? connection.bot_id,
    workspace_id: tokens.workspace_id ?? connection.workspace_id,
    workspace_name: tokens.workspace_name ?? connection.workspace_name,
    workspace_icon: tokens.workspace_icon ?? connection.workspace_icon,
  };
  await saveNotionConnection(connection.user_id, merged);
  return {
    ...connection,
    access_token: merged.access_token,
    refresh_token: merged.refresh_token ?? null,
  };
}

/**
 * Authenticated Notion API request for a user, refreshing the token once on
 * 401 before giving up with a "reconnect" error.
 */
export async function notionFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let connection = await getNotionConnection(userId);
  if (!connection) throw new NotionNotConnectedError();

  const doFetch = (token: string) =>
    fetch(`${NOTION_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

  let res = await doFetch(connection.access_token);
  if (res.status === 401) {
    connection = await refreshConnection(connection);
    res = await doFetch(connection.access_token);
    if (res.status === 401) throw new NotionAuthError();
  }
  return res;
}

/** JSON helper over notionFetch that raises readable errors on failure. */
export async function notionJson<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await notionFetch(userId, path, init);
  const data = (await res.json().catch(() => null)) as
    | (T & { message?: string; code?: string })
    | null;
  if (!res.ok || !data) {
    const detail = data?.message ?? data?.code ?? `HTTP ${res.status}`;
    throw new Error(`Notion API error: ${detail}`);
  }
  return data;
}
