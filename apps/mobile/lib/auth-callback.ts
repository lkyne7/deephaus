/** Parse both PKCE query callbacks and implicit fragment callbacks. No credentials are logged. */
export function parseAuthCallback(input: string, scheme = "deephaus") {
  const url = new URL(input);
  const route = `${url.hostname}${url.pathname}`.replace(/^\/+/, "");
  if (
    url.protocol !== `${scheme}:` &&
    url.protocol !== "exp:" &&
    url.protocol !== "exps:"
  )
    return null;
  if (
    url.protocol === `${scheme}:`
      ? route !== "auth/callback"
      : url.pathname !== "/--/auth/callback"
  )
    return null;
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((value, key) =>
    params.set(key, value),
  );
  const error = params.get("error_description") || params.get("error");
  if (error)
    throw new Error(
      "This sign-in link is invalid or expired. Request a new link.",
    );
  return {
    code: params.get("code"),
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    recovery:
      params.get("type") === "recovery" || params.get("recovery") === "1",
  };
}
