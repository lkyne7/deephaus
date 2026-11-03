import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import type { DesktopNotification } from "@deephaus/shared" with { "resolution-mode": "import" };
import { loadConfig, safeAppPath, type DesktopConfig } from "./config";
import { IPC, type BootstrapInfo } from "./ipc";
import { findDeepLinkArgument, registerScheme, resolveDeepLink } from "./links";
import { installMenu } from "./menu";
import { loadState } from "./state";
import { checkForUpdates, currentUpdateState, startUpdater } from "./updater";
import { createAppWindow, type AppWindow } from "./window";

let config: DesktopConfig;
try {
  config = loadConfig();
} catch (error) {
  dialog.showErrorBox("DeepHaus", error instanceof Error ? error.message : String(error));
  app.exit(1);
  throw error;
}

if (process.platform === "win32") app.setAppUserModelId(config.appUserModelId);
app.setName(config.productName);
// Tests and side-by-side dev profiles isolate their storage and instance lock.
if (!app.isPackaged && process.env.DEEPHAUS_DESKTOP_USER_DATA) {
  app.setPath("userData", process.env.DEEPHAUS_DESKTOP_USER_DATA);
}

// One running instance: a second launch (or a Windows/Linux deep link) hands
// its arguments to the first and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  const state = loadState();
  let appWindow: AppWindow | null = null;
  let queuedLink: string | undefined = findDeepLinkArgument(config, process.argv);

  registerScheme(config);

  function openWindow(): AppWindow {
    if (appWindow && !appWindow.window.isDestroyed()) return appWindow;
    appWindow = createAppWindow(config, state);
    appWindow.window.on("closed", () => {
      appWindow = null;
    });
    return appWindow;
  }

  function focusWindow(): void {
    const target = openWindow().window;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  }

  async function handleDeepLink(raw: string): Promise<void> {
    const action = resolveDeepLink(config, raw);
    if (action.kind === "ignore") return;
    const target = openWindow();
    focusWindow();
    if (action.kind === "navigate") {
      await target.navigate(action.appPath);
      return;
    }
    // Auth results need a full load so the server route can set cookies.
    await target.loadApp(action.appPath);
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) void handleDeepLink(url);
    else queuedLink = url;
  });
  app.on("second-instance", (_event, argv) => {
    const link = findDeepLinkArgument(config, argv);
    focusWindow();
    if (link) void handleDeepLink(link);
  });

  ipcMain.on(IPC.bootstrap, (event) => {
    const info: BootstrapInfo = {
      version: config.version,
      platform: process.platform,
      variant: config.variant,
      origin: config.origin,
    };
    event.returnValue = info;
  });
  ipcMain.handle(IPC.openExternal, async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^(https?|mailto):/i.test(url)) {
      throw new Error("Only http(s) and mailto links can be opened externally.");
    }
    await shell.openExternal(url);
  });
  ipcMain.on(IPC.setBadge, (_event, count: unknown) => {
    const value = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    app.setBadgeCount(value);
  });
  ipcMain.on(IPC.notify, (_event, payload: unknown) => {
    if (!Notification.isSupported() || !payload || typeof payload !== "object") return;
    const { title, body, path: appPath } = payload as Partial<DesktopNotification>;
    if (typeof title !== "string" || !title) return;
    const notification = new Notification({ title, body: typeof body === "string" ? body : undefined });
    notification.on("click", () => {
      focusWindow();
      if (typeof appPath === "string") void openWindow().navigate(safeAppPath(appPath));
    });
    notification.show();
  });
  ipcMain.handle(IPC.checkForUpdates, async () => {
    const state = await checkForUpdates();
    return state.status === "checking" ? currentUpdateState() : state;
  });
  ipcMain.on(IPC.retry, () => {
    void openWindow().loadApp();
  });

  void app.whenReady().then(async () => {
    installMenu(config, {
      navigate: (appPath) => {
        focusWindow();
        void openWindow().navigate(appPath);
      },
      checkForUpdates: () => void checkForUpdates(),
    });

    const target = openWindow();
    if (queuedLink) {
      const link = queuedLink;
      queuedLink = undefined;
      await handleDeepLink(link);
    } else {
      await target.loadApp();
    }
    void startUpdater(config);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow().loadApp();
    else focusWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
