import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getEffectivePlan, planIncludes } from "@/lib/billing/access";
import {
  GOOGLE_DRIVE_STATE_COOKIE,
  googleDriveAuthorizeUrl,
  googleDriveConfigured,
  googleDriveRedirectUri,
} from "@/lib/google-drive/client";
import { requestOrigin, requestIsSecure } from "@/lib/notion/request-origin";

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/create";
  return value;
}

function returnUrl(origin: string, path: string, status: string): URL {
  const url = new URL(path, origin);
  url.searchParams.set("googleDrive", status);
  return url;
}

/** Start the Google Drive OAuth web-server flow. */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("returnTo"));
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (!planIncludes(await getEffectivePlan(user.id), "plus")) {
    return NextResponse.redirect(returnUrl(origin, returnTo, "upgrade-required"));
  }
  if (!googleDriveConfigured()) {
    return NextResponse.redirect(returnUrl(origin, returnTo, "unconfigured"));
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(
    googleDriveAuthorizeUrl(state, googleDriveRedirectUri(origin)),
  );
  response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(request),
    path: "/",
    maxAge: 600,
  });
  return response;
}
