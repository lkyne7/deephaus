import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  GOOGLE_DRIVE_STATE_COOKIE,
  exchangeGoogleDriveCode,
  googleDriveRedirectUri,
  saveGoogleDriveConnection,
} from "@/lib/google-drive/client";
import { requestOrigin } from "@/lib/notion/request-origin";

function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/create";
  return value;
}

function returnUrl(
  origin: string,
  path: string,
  status: "connected" | "error",
  message?: string,
): URL {
  const url = new URL(path, origin);
  url.searchParams.set("googleDrive", status);
  if (message) url.searchParams.set("message", message);
  return url;
}

/** Verify OAuth state, exchange the code, and save the user's Drive connection. */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const { searchParams } = new URL(request.url);
  let state: string | null = null;
  let returnTo = "/create";

  const rawCookie = request.cookies.get(GOOGLE_DRIVE_STATE_COOKIE)?.value;
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie) as { state?: string; returnTo?: string };
      state = parsed.state ?? null;
      returnTo = safeReturnPath(parsed.returnTo);
    } catch {
      // Treat malformed state as missing.
    }
  }

  const fail = (message: string) => {
    const response = NextResponse.redirect(returnUrl(origin, returnTo, "error", message));
    response.cookies.delete(GOOGLE_DRIVE_STATE_COOKIE);
    return response;
  };

  const oauthError = searchParams.get("error");
  if (oauthError) {
    return fail(
      oauthError === "access_denied"
        ? "Google Drive access was declined."
        : `Google Drive error: ${oauthError}`,
    );
  }

  const code = searchParams.get("code");
  if (!code) return fail("Missing authorization code.");
  if (!state || searchParams.get("state") !== state) {
    return fail("Sign-in state mismatch. Please try connecting again.");
  }

  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeGoogleDriveCode(code, googleDriveRedirectUri(origin));
    await saveGoogleDriveConnection(user.id, tokens);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not connect Google Drive.");
  }

  const response = NextResponse.redirect(returnUrl(origin, returnTo, "connected"));
  response.cookies.delete(GOOGLE_DRIVE_STATE_COOKIE);
  return response;
}
