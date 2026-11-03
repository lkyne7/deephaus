import { app, BrowserWindow } from "electron";
import type { DesktopUpdateState } from "@deephaus/shared" with { "resolution-mode": "import" };
import type { DesktopConfig } from "./config";
import { IPC } from "./ipc";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15_000;

let current: DesktopUpdateState = { status: "idle" };
let started = false;

function broadcast(state: DesktopUpdateState): void {
  current = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.updateState, state);
  }
}

export function currentUpdateState(): DesktopUpdateState {
  return current;
}

/**
 * electron-updater reads `app-update.yml` that electron-builder writes into
 * the packaged app, so unpackaged runs report "unsupported" instead of
 * contacting GitHub.
 */
export async function checkForUpdates(): Promise<DesktopUpdateState> {
  if (!app.isPackaged) {
    broadcast({ status: "unsupported", message: "Updates apply to installed builds only." });
    return current;
  }
  const { autoUpdater } = await import("electron-updater");
  try {
    broadcast({ status: "checking" });
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || !result.isUpdateAvailable) {
      broadcast({ status: "idle", version: app.getVersion() });
    }
  } catch (error) {
    broadcast({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
  return current;
}

export async function startUpdater(config: DesktopConfig): Promise<void> {
  if (started || !app.isPackaged) return;
  started = true;
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (config.variant === "staging") {
    // Staging builds publish as GitHub pre-releases on their own channel.
    autoUpdater.channel = "staging";
    autoUpdater.allowPrerelease = true;
  }

  autoUpdater.on("update-available", (info) => broadcast({ status: "available", version: info.version }));
  autoUpdater.on("download-progress", (progress) =>
    broadcast({ status: "downloading", message: `${Math.round(progress.percent)}%` }),
  );
  autoUpdater.on("update-downloaded", (info) => broadcast({ status: "ready", version: info.version }));
  autoUpdater.on("update-not-available", () => broadcast({ status: "idle", version: app.getVersion() }));
  autoUpdater.on("error", (error) => broadcast({ status: "error", message: error.message }));

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
}
