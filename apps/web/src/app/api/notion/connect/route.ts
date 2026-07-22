import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getEffectivePlan, planIncludes } from "@/lib/billing/access";
import {
  NOTION_STATE_COOKIE,
  notionAuthorizeUrl,
  notionConfigured,
  notionRedirectUri,
} from "@/lib/notion/client";
import { requestOrigin, requestIsSecure } from "@/lib/notion/request-origin";

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/notes";
  return value;
}

/**
 * GET /api/notion/connect — browser navigation entry point for the Notion
 * OAuth flow. Sets a CSRF state cookie and redirects to Notion's consent page.
 */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const { searchParams } = new URL(request.url);
  const returnTo = safeReturnPath(searchParams.get("returnTo"));

  const { user } = await requireUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }
  if (!planIncludes(await getEffectivePlan(user.id), "plus")) {
    const url = new URL(returnTo, origin);
    url.searchParams.set("notion", "upgrade-required");
    return NextResponse.redirect(url);
  }

  if (!notionConfigured()) {
    return NextResponse.redirect(`${origin}${returnTo}?notion=unconfigured`);
  }

  const state = crypto.randomUUID();
  const authorizeUrl = notionAuthorizeUrl(state, notionRedirectUri(origin));

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(NOTION_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(request),
    path: "/",
    maxAge: 600,
  });
  return response;
}
