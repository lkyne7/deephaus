import { BrowserWindow, net, screen, session, shell, type Session } from "electron";
import path from "node:path";
import type { DesktopConfig } from "./config";
import { IPC } from "./ipc";
import { saveState, type DesktopState } from "./state";

const PRELOAD = path.join(__dirname, "..", "preload", "index.js");
const OFFLINE_PAGE = path.join(__dirname, "..", "..", "resources", "offline.html");

/** Chromium "aborted" (-3) fires for in-flight loads we replaced ourselves. */
const ERR_ABORTED = -3;

export interface AppWindow {
  window: BrowserWindow;
  /** Load an app-relative path, or the bundled offline page when that cannot work. */
  loadApp(appPath?: string): Promise<void>;
  /** Client-side navigate when the app is showing, full load otherwise. */
  navigate(appPath: string): Promise<void>;
  isShowingApp(): boolean;
}

function isAppUrl(config: DesktopConfig, url: string): boolean {
  try {
    return new URL(url).origin === config.origin;
  } catch {
    return false;
  }
}

function appPathFromUrl(config: DesktopConfig, url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== config.origin) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function configureSession(config: DesktopConfig, appSession: Session): void {
  // Lets the web app recognise the shell even before the bridge is read.
  appSession.setUserAgent(`${appSession.getUserAgent()} DeepHausDesktop/${config.version}`);

  appSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const requestingApp = isAppUrl(config, webContents.getURL());
    const allowed = new Set([
      // Local replica (OPFS) and media cache must never be evicted.
      "persistent-storage",
      "notifications",
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
      // Audio clips are recorded in the card editor.
      "media",
    ]);
    callback(requestingApp && allowed.has(permission));
  });
  appSession.setPermissionCheckHandler((webContents, permission) => {
    const url = webContents?.getURL() ?? "";
    return isAppUrl(config, url) && ["persistent-storage", "notifications", "clipboard-read", "media"].includes(permission);
  });
}

function initialBounds(state: DesktopState): Electron.Rectangle & { maximized: boolean } {
  const saved = state.bounds;
  const fallback = { width: 1280, height: 840 };
  if (!saved) return { ...fallback, x: undefined as unknown as number, y: undefined as unknown as number, maximized: false };
  // Drop bounds that no longer intersect a display (monitor unplugged).
  const visible = screen.getAllDisplays().some((display) => {
    if (saved.x === undefined || saved.y === undefined) return true;
    const { x, y, width, height } = display.workArea;
    return saved.x < x + width && saved.x + saved.width > x && saved.y < y + height && saved.y + saved.height > y;
  });
  if (!visible) return { ...fallback, x: undefined as unknown as number, y: undefined as unknown as number, maximized: false };
  return {
    x: saved.x as number,
    y: saved.y as number,
    width: Math.max(saved.width, 720),
    height: Math.max(saved.height, 520),
    maximized: saved.maximized ?? false,
  };
}

export function createAppWindow(config: DesktopConfig, state: DesktopState): AppWindow {
  const appSession = session.fromPartition(config.partition);
  configureSession(config, appSession);

  const bounds = initialBounds(state);
  const window = new BrowserWindow({
    title: config.productName,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: "#0C0E12",
    webPreferences: {
      session: appSession,
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  if (bounds.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());

  const rememberBounds = () => {
    if (window.isDestroyed()) return;
    const maximized = window.isMaximized();
    const rect = maximized ? state.bounds ?? window.getNormalBounds() : window.getNormalBounds();
    state.bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, maximized };
    saveState(state);
  };
  window.on("resize", rememberBounds);
  window.on("move", rememberBounds);
  window.on("maximize", rememberBounds);
  window.on("unmaximize", rememberBounds);
  window.on("close", () => {
    rememberBounds();
    saveState(state, true);
  });

  const contents = window.webContents;

  // Everything outside the app origin opens in the system browser.
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(config, url) || url.startsWith("file:")) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(config, url)) {
      void contents.loadURL(url);
    } else if (/^(https?|mailto):/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  contents.on("did-finish-load", () => {
    const url = contents.getURL();
    if (!isAppUrl(config, url)) return;
    if (!state.hasLoadedApp) {
      state.hasLoadedApp = true;
    }
    state.lastPath = appPathFromUrl(config, url) ?? state.lastPath;
    saveState(state);
  });
  contents.on("did-navigate-in-page", (_event, url) => {
    const appPath = appPathFromUrl(config, url);
    if (appPath) {
      state.lastPath = appPath;
      saveState(state);
    }
  });

  let pendingPath = state.lastPath;
  const loadOfflinePage = () => contents.loadFile(OFFLINE_PAGE);

  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    if (!isAppUrl(config, validatedUrl)) return;
    console.warn(`[deephaus-desktop] load failed (${errorCode} ${errorDescription}) for ${validatedUrl}`);
    void loadOfflinePage();
  });

  async function loadApp(appPath = pendingPath): Promise<void> {
    pendingPath = appPath;
    // A fresh install has no service worker yet, so a remote load cannot be
    // served from cache; show the bundled page instead of a Chromium error.
    if (!state.hasLoadedApp && !net.isOnline()) {
      await loadOfflinePage();
      return;
    }
    await contents.loadURL(`${config.origin}${appPath}`).catch((error: Error) => {
      // did-fail-load already switched to the offline page.
      console.warn("[deephaus-desktop] loadURL rejected", error.message);
    });
  }

  function isShowingApp(): boolean {
    return isAppUrl(config, contents.getURL());
  }

  async function navigate(appPath: string): Promise<void> {
    if (isShowingApp()) {
      contents.send(IPC.navigate, appPath);
      return;
    }
    await loadApp(appPath);
  }

  return { window, loadApp, navigate, isShowingApp };
}
