type AuthLikeError = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
};

/** True when Supabase auth failed due to transport, not an invalid session. */
export function isAuthNetworkError(error: AuthLikeError | null | undefined): boolean {
  if (!error) return false;

  const msg = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  const name = (error.name ?? "").toLowerCase();

  if (
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    code === "etimedout" ||
    code === "econnreset" ||
    name.includes("typeerror")
  ) {
    return true;
  }

  return false;
}

/** Only clear cookies when the auth server rejected the session, not on outages. */
export function shouldClearStaleSession(error: AuthLikeError | null | undefined): boolean {
  if (!error || isAuthNetworkError(error)) return false;

  const msg = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (error.status === 401 || error.status === 403) return true;
  if (code.includes("refresh_token") || code.includes("session_not_found")) return true;
  if (msg.includes("invalid refresh token") || msg.includes("refresh token not found")) return true;
  if (msg.includes("invalid jwt") || msg.includes("jwt expired")) return true;

  return false;
}

export function formatAuthNetworkError(error: unknown): string {
  if (isAuthNetworkError(error as AuthLikeError)) {
    return "Unable to reach the sign-in service. Check your internet connection and try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
