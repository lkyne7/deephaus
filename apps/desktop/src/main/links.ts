import { app } from "electron";
import path from "node:path";
import { safeAppPath, type DesktopConfig } from "./config";

export type LinkAction =
  | { kind: "auth-callback"; appPath: string }
  | { kind: "auth-error"; appPath: string }
  | { kind: "navigate"; appPath: string }
  | { kind: "ignore" };

/**
 * Turn a `deephaus-desktop://…` URL into an app action.
 *
 * - `deephaus-desktop://auth/callback?code=…&next=/decks` → the hosted
 *   `/auth/callback` route, which exchanges the PKCE code using the verifier
 *   cookie the window stored when sign-in started.
 * - `deephaus-desktop://decks/<id>/study` → `/decks/<id>/study`.
 */
export function resolveDeepLink(config: DesktopConfig, raw: string): LinkAction {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "ignore" };
  }
  if (url.protocol !== `${config.scheme}:`) return { kind: "ignore" };

  if (url.host === "auth" && url.pathname === "/callback") {
    const next = safeAppPath(url.searchParams.get("next"));
    const error = url.searchParams.get("error") ?? url.searchParams.get("error_description");
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type");
    if (error && !code) {
      const message = url.searchParams.get("error_description") ?? error;
      return { kind: "auth-error", appPath: `/login?error=auth&message=${encodeURIComponent(message)}` };
    }
    const params = new URLSearchParams();
    if (code) params.set("code", code);
    if (tokenHash && type) {
      params.set("token_hash", tokenHash);
      params.set("type", type);
    }
    if (!params.has("code") && !params.has("token_hash")) return { kind: "ignore" };
    params.set("next", next);
    return { kind: "auth-callback", appPath: `/auth/callback?${params.toString()}` };
  }

  const appPath = safeAppPath(`/${url.host}${url.pathname}${url.search}`, "/dashboard");
  return { kind: "navigate", appPath };
}

export function findDeepLinkArgument(config: DesktopConfig, argv: string[]): string | undefined {
  const prefix = `${config.scheme}://`;
  return argv.find((argument) => argument.startsWith(prefix));
}

/** Register the custom scheme so the system browser can hand OAuth back to us. */
export function registerScheme(config: DesktopConfig): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(config.scheme);
    return;
  }
  // Unpackaged (pnpm dev): Windows/Linux need the executable and entry script.
  if (process.platform !== "darwin" && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(config.scheme, process.execPath, [path.resolve(process.argv[1])]);
  }
}
