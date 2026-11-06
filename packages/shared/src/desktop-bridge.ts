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

/** Agent CLIs the desktop app can run on the user's own subscription. */
export const LOCAL_AI_ENGINES = ["claude", "codex"] as const;
export type LocalAiEngine = (typeof LOCAL_AI_ENGINES)[number];

export function parseLocalAiEngine(value: unknown): LocalAiEngine | undefined {
  return LOCAL_AI_ENGINES.find((engine) => engine === value);
}

export interface LocalAiStatus {
  engine: LocalAiEngine;
  installed: boolean;
  signedIn: boolean;
  /** Plan the CLI reports, such as "max" or "ChatGPT". */
  plan?: string;
}

export interface LocalAiRequest {
  /** Caller-chosen id, used to cancel this run. */
  id: string;
  engine: LocalAiEngine;
  system: string;
  prompt: string;
  /** JSON Schema the final answer must match. */
  schema: Record<string, unknown>;
}

export interface DesktopLocalAi {
  status(): Promise<LocalAiStatus[]>;
  /** Resolves with the model's JSON answer as text. */
  generate(request: LocalAiRequest): Promise<string>;
  cancel(id: string): Promise<void>;
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
  /** Absent in desktop builds from before local AI engines. */
  readonly ai?: DesktopLocalAi;
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
