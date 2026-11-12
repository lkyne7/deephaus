import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import {
  RECOVERY_COOKIE,
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RESET_PASSWORD_PATH,
  isRecoveryCallback,
} from "@/lib/auth-recovery";
import { recordTermsAcceptance } from "@deephaus/shared";
import { captureFirstSignIn } from "@/lib/posthog-server";

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/dashboard";
  }
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const recovery = isRecoveryCallback(searchParams);
  const next = recovery ? RESET_PASSWORD_PATH : safeNextPath(searchParams.get("next"));

  const redirectTo = `${origin}${next}`;
  const response = NextResponse.redirect(redirectTo);

  const failed = (message?: string) => {
    if (recovery) return NextResponse.redirect(`${origin}${RESET_PASSWORD_PATH}?error=link`);
    return NextResponse.redirect(
      message ? `${origin}/?error=auth&message=${encodeURIComponent(message)}` : `${origin}/?error=auth`,
    );
  };

  const succeeded = () => {
    if (recovery) {
      response.cookies.set(RECOVERY_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
        path: "/",
      });
    }
    return response;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return failed(error.message);
    await captureFirstSignIn(data.user);
    await recordTermsAcceptance(supabase, data.user);
    return succeeded();
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failed(error.message);
    await captureFirstSignIn(data.user);
    await recordTermsAcceptance(supabase, data.user);
    return succeeded();
  }

  return failed();
}
