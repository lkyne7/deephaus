/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  /** Renderer → main (sync): bootstrap info for the bridge. */
  bootstrap: "deephaus:bootstrap",
  openExternal: "deephaus:open-external",
  setBadge: "deephaus:set-badge",
  notify: "deephaus:notify",
  checkForUpdates: "deephaus:check-for-updates",
  /** Offline page → main: try loading the app again. */
  retry: "deephaus:retry",
  /** Main → renderer. */
  navigate: "deephaus:navigate",
  updateState: "deephaus:update-state",
} as const;

export interface BootstrapInfo {
  version: string;
  platform: NodeJS.Platform;
  variant: "development" | "staging" | "production";
  origin: string;
}
