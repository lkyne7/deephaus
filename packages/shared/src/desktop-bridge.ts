/**
 * Contract between the Electron desktop shell (apps/desktop) and the web app.
 *
 * The desktop preload script installs `window.deephausDesktop` before any page
 * script runs. The web app treats its absence as "running in a browser".
 */

export type DesktopPlatform = "darwin" | "win32" | "linux";
export type DesktopVariant = "development" | "staging" | "production";

export interface DesktopUpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "unsupported";
  version?: string;
  message?: string;
}

export interface DesktopNotification {
  title: string;
  body?: string;
  /** App-relative path to open when the notification is clicked. */
  path?: string;
}

export interface DesktopBridge {
  readonly version: string;
  readonly platform: DesktopPlatform;
  readonly variant: DesktopVariant;
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>;
  /** Dock / taskbar badge. `0` clears it. */
  setBadgeCount(count: number): void;
  notify(notification: DesktopNotification): void;
  /**
   * Fired for deep links (`deephaus-desktop://decks/<id>`) and native menu
   * shortcuts. The handler receives an app-relative path such as `/decks/<id>`.
   */
  onNavigate(handler: (path: string) => void): () => void;
  checkForUpdates(): Promise<DesktopUpdateState>;
  onUpdateState(handler: (state: DesktopUpdateState) => void): () => void;
}

/** Custom URL scheme host used for OAuth returns, mirrored by apps/mobile. */
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/callback";

export function desktopScheme(variant: DesktopVariant): string {
  return variant === "staging" ? "deephaus-desktop-staging" : "deephaus-desktop";
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof globalThis === "undefined") return null;
  const bridge = (globalThis as { deephausDesktop?: DesktopBridge }).deephausDesktop;
  return bridge ?? null;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}
