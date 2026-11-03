import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopNotification, DesktopUpdateState } from "@deephaus/shared" with { "resolution-mode": "import" };
import type { BootstrapInfo } from "../main/ipc";

// Sandboxed preloads cannot require sibling modules, so the channel names are
// repeated here. Keep in sync with src/main/ipc.ts (checked by test/ipc.test.mjs).
const IPC = {
  bootstrap: "deephaus:bootstrap",
  openExternal: "deephaus:open-external",
  setBadge: "deephaus:set-badge",
  notify: "deephaus:notify",
  checkForUpdates: "deephaus:check-for-updates",
  retry: "deephaus:retry",
  navigate: "deephaus:navigate",
  updateState: "deephaus:update-state",
} as const;

const info = ipcRenderer.sendSync(IPC.bootstrap) as BootstrapInfo;

const onApp = window.location.origin === info.origin;
const onShellPage = window.location.protocol === "file:";

if (onApp) {
  const bridge: DesktopBridge = {
    version: info.version,
    platform: info.platform as DesktopBridge["platform"],
    variant: info.variant,
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
    setBadgeCount: (count) => ipcRenderer.send(IPC.setBadge, count),
    notify: (notification: DesktopNotification) => ipcRenderer.send(IPC.notify, notification),
    onNavigate: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, path: string) => handler(path);
      ipcRenderer.on(IPC.navigate, listener);
      return () => ipcRenderer.off(IPC.navigate, listener);
    },
    checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates) as Promise<DesktopUpdateState>,
    onUpdateState: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => handler(state);
      ipcRenderer.on(IPC.updateState, listener);
      return () => ipcRenderer.off(IPC.updateState, listener);
    },
  };
  contextBridge.exposeInMainWorld("deephausDesktop", bridge);
}

if (onShellPage) {
  contextBridge.exposeInMainWorld("deephausDesktopShell", {
    productName: info.variant === "production" ? "DeepHaus" : `DeepHaus ${info.variant}`,
    retry: () => ipcRenderer.send(IPC.retry),
  });
}
