import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  NOTION_STATE_COOKIE,
  exchangeNotionCode,
  notionRedirectUri,
  saveNotionConnection,
} from "@/lib/notion/client";

function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/notes";
  return value;
}

/**
 * GET /api/notion/callback — OAuth redirect target. Verifies the CSRF state
 * cookie, exchanges the code for tokens, and stores the connection.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);

  let state: string | null = null;
  let returnTo = "/notes";
  const rawCookie = request.cookies.get(NOTION_STATE_COOKIE)?.value;
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie) as { state?: string; returnTo?: string };
      state = parsed.state ?? null;
      returnTo = safeReturnPath(parsed.returnTo);
    } catch {
      // Malformed cookie — treat as missing state.
    }
  }

  const fail = (message: string) => {
    const response = NextResponse.redirect(
      `${origin}${returnTo}?notion=error&message=${encodeURIComponent(message)}`,
    );
    response.cookies.delete(NOTION_STATE_COOKIE);
    return response;
  };

  const oauthError = searchParams.get("error");
  if (oauthError) {
    return fail(
      oauthError === "access_denied" ? "Notion access was declined." : `Notion error: ${oauthError}`,
    );
  }

  const code = searchParams.get("code");
  if (!code) return fail("Missing authorization code.");
  if (!state || searchParams.get("state") !== state) {
    return fail("Sign-in state mismatch. Please try connecting again.");
  }

  const { user } = await requireUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const tokens = await exchangeNotionCode(code, notionRedirectUri(origin));
    await saveNotionConnection(user.id, tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect Notion.";
    return fail(message);
  }

  const response = NextResponse.redirect(`${origin}${returnTo}?notion=connected`);
  response.cookies.delete(NOTION_STATE_COOKIE);
  return response;
}
