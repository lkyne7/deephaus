import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  isApiToken,
  tokenHasScope,
  verifyApiToken,
} from "@/lib/auth/api-token";
import { checkPatRateLimit } from "@/lib/auth/rate-limit";
import { setRequestUserId } from "@/lib/perf/context";
import {
  createClient,
  createServiceClient,
  getRequestBearerToken,
} from "@/lib/supabase/server";

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
  rateLimit?: "costly";
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

export async function requireAuth(
  options: RequireAuthOptions = {},
): Promise<AuthContext | AuthFailure> {
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
        response: NextResponse.json(
          { error: "Insufficient token scope" },
          { status: 403 },
        ),
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
    if (options.rateLimit) {
      const response = await costlyLimit(user.id);
      if (response)
        return { user: null, supabase: createServiceClient(), response };
    }
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
  // Only a server-verified user may authorize privileged work. Cookie session
  // objects are client-controlled, including when verification is unavailable.
  let user: User | null = null;
  try {
    const result = bearerToken
      ? await supabase.auth.getUser(bearerToken)
      : await supabase.auth.getUser();
    if (
      result.error &&
      (!result.error.status ||
        result.error.status === 429 ||
        result.error.status >= 500)
    ) {
      return {
        user: null,
        supabase,
        response: NextResponse.json(
          {
            error:
              "Sign-in verification is temporarily unavailable. Please retry.",
            code: "AUTH_UNAVAILABLE",
          },
          { status: 503, headers: { "Retry-After": "5" } },
        ),
      };
    }
    user = result.error ? null : result.data.user;
  } catch {
    return {
      user: null,
      supabase,
      response: NextResponse.json(
        {
          error:
            "Sign-in verification is temporarily unavailable. Please retry.",
          code: "AUTH_UNAVAILABLE",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    };
  }

  if (!user) {
    return {
      user: null,
      supabase,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (options.rateLimit) {
    const response = await costlyLimit(user.id);
    if (response) return { user: null, supabase, response };
  }
  setRequestUserId(user.id);
  return { user, supabase, response: null, authMethod: "session" };
}

/** Session-only auth (e.g. token management, OAuth flows). */
export async function requireUser(options: RequireAuthOptions = {}) {
  const auth = await requireAuth(options);
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

/** Atomic across server instances and all tokens/sessions belonging to the account. */
async function costlyLimit(userId: string) {
  const { data, error } = await createServiceClient().rpc(
    "consume_api_rate_limit",
    { p_key: `costly:${userId}`, p_limit: 12, p_window_seconds: 60 },
  );
  if (error)
    return NextResponse.json(
      { error: "Request limits are temporarily unavailable. Please retry." },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  return data
    ? null
    : NextResponse.json(
        { error: "Too many requests. Please wait a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
}
