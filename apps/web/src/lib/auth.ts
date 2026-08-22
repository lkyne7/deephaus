import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isApiToken, tokenHasScope, verifyApiToken } from "@/lib/auth/api-token";
import { checkPatRateLimit } from "@/lib/auth/rate-limit";
import { setRequestUserId } from "@/lib/perf/context";
import { createClient, createServiceClient, getRequestBearerToken } from "@/lib/supabase/server";

export type AuthContext = {
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
  response: null;
  authMethod: "session" | "pat";
  patScopes?: string[];
};

export type AuthFailure = {
  user: null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  response: NextResponse;
  authMethod?: undefined;
  patScopes?: undefined;
};

type RequireAuthOptions = {
  /** Required PAT scope when authenticated via personal access token. */
  patScope?: string;
};

function patUser(userId: string): User {
  return {
    id: userId,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
  } as User;
}

export async function requireAuth(options: RequireAuthOptions = {}): Promise<AuthContext | AuthFailure> {
  const bearerToken = await getRequestBearerToken();

  if (bearerToken && isApiToken(bearerToken)) {
    const verified = await verifyApiToken(bearerToken);
    if (!verified) {
      return {
        user: null,
        supabase: await createClient(),
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    const requiredScope = options.patScope ?? "study";
    if (!tokenHasScope(verified.scopes, requiredScope)) {
      return {
        user: null,
        supabase: await createClient(),
        response: NextResponse.json({ error: "Insufficient token scope" }, { status: 403 }),
      };
    }

    const rateLimit = checkPatRateLimit(verified.tokenId);
    if (rateLimit.limited) {
      return {
        user: null,
        supabase: await createClient(),
        response: NextResponse.json(
          { error: "Rate limit exceeded" },
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        ),
      };
    }

    const user = patUser(verified.userId);
    setRequestUserId(user.id);
    return {
      user,
      supabase: createServiceClient(),
      response: null,
      authMethod: "pat",
      patScopes: verified.scopes,
    };
  }

  const supabase = await createClient();
  let user = null;

  if (bearerToken) {
    const result = await supabase.auth.getUser(bearerToken);
    user = result.data.user;
  } else {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (!user) {
      const { data: sessionData } = await supabase.auth.getSession();
      user = sessionData.session?.user ?? null;
    }
  }

  if (!user) {
    return {
      user: null,
      supabase,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  setRequestUserId(user.id);
  return { user, supabase, response: null, authMethod: "session" };
}

/** Session-only auth (e.g. token management, OAuth flows). */
export async function requireUser() {
  const auth = await requireAuth();
  if (auth.response) return auth;
  if (auth.authMethod === "pat") {
    return {
      user: null,
      supabase: auth.supabase,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return auth;
}
