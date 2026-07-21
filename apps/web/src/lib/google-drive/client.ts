import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { canonicalAppOrigin } from "@/lib/notion/client";

export const GOOGLE_DRIVE_STATE_COOKIE = "google_drive_oauth_state";
export const GOOGLE_DRIVE_CALLBACK_PATH = "/api/google-drive/callback";
export const GOOGLE_DRIVE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";

export class GoogleDriveNotConnectedError extends Error {
  constructor() {
    super("Google Drive is not connected for this account.");
    this.name = "GoogleDriveNotConnectedError";
  }
}

export class GoogleDriveAuthError extends Error {
  constructor(message = "Google Drive authorization expired. Please reconnect Google Drive.") {
    super(message);
    this.name = "GoogleDriveAuthError";
  }
}

export type GoogleDriveConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  account_email: string | null;
  account_name: string | null;
};

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

type GoogleProfile = {
  email?: string;
  name?: string;
};

export function googleDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.NEXT_PUBLIC_GOOGLE_API_KEY &&
      process.env.NEXT_PUBLIC_GOOGLE_APP_ID,
  );
}

export function googleDriveRedirectUri(origin: string): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = canonicalAppOrigin(appUrl || origin);
  return `${base}${GOOGLE_DRIVE_CALLBACK_PATH}`;
}

export function googleDriveAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as
    | (GoogleTokenResponse & { error?: string; error_description?: string })
    | null;
  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    throw new GoogleDriveAuthError(`Google token request failed (${detail}).`);
  }
  return data;
}

export async function exchangeGoogleDriveCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export async function getGoogleDriveConnection(
  userId: string,
): Promise<GoogleDriveConnection | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("google_drive_connections")
    .select("user_id, access_token, refresh_token, expires_at, account_email, account_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as GoogleDriveConnection | null) ?? null;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return {};
  return (await res.json()) as GoogleProfile;
}

export async function saveGoogleDriveConnection(
  userId: string,
  tokens: GoogleTokenResponse,
): Promise<void> {
  const existing = await getGoogleDriveConnection(userId);
  const profile = await fetchGoogleProfile(tokens.access_token);
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000).toISOString();
  const supabase = createServiceClient();
  const { error } = await supabase.from("google_drive_connections").upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
      expires_at: expiresAt,
      account_email: profile.email ?? existing?.account_email ?? null,
      account_name: profile.name ?? existing?.account_name ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Failed to save Google Drive connection: ${error.message}`);
}

export async function deleteGoogleDriveConnection(userId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("google_drive_connections").delete().eq("user_id", userId);
}

async function refreshConnection(
  connection: GoogleDriveConnection,
): Promise<GoogleDriveConnection> {
  if (!connection.refresh_token) throw new GoogleDriveAuthError();
  let tokens: GoogleTokenResponse;
  try {
    tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    });
  } catch {
    throw new GoogleDriveAuthError();
  }
  await saveGoogleDriveConnection(connection.user_id, tokens);
  return {
    ...connection,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? connection.refresh_token,
    expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000).toISOString(),
  };
}

/** Return a valid short-lived access token, refreshing server-side if needed. */
export async function getGoogleDriveAccessToken(userId: string): Promise<string> {
  let connection = await getGoogleDriveConnection(userId);
  if (!connection) throw new GoogleDriveNotConnectedError();
  if (new Date(connection.expires_at).getTime() <= Date.now() + 60_000) {
    connection = await refreshConnection(connection);
  }
  return connection.access_token;
}

/** Authenticated Drive API request with one refresh-and-retry on HTTP 401. */
export async function googleDriveFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = async (token: string) =>
    fetch(`${GOOGLE_DRIVE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      cache: "no-store",
    });

  let token = await getGoogleDriveAccessToken(userId);
  let res = await request(token);
  if (res.status === 401) {
    const connection = await getGoogleDriveConnection(userId);
    if (!connection) throw new GoogleDriveNotConnectedError();
    token = (await refreshConnection(connection)).access_token;
    res = await request(token);
    if (res.status === 401) throw new GoogleDriveAuthError();
  }
  return res;
}
