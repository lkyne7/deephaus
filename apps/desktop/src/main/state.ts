import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface DesktopState {
  /** The hosted app has rendered at least once, so its service worker exists. */
  hasLoadedApp: boolean;
  /** Last app-relative path the window showed; restored on next launch. */
  lastPath: string;
  bounds?: WindowBounds;
}

const DEFAULTS: DesktopState = { hasLoadedApp: false, lastPath: "/dashboard" };

function stateFile(): string {
  return path.join(app.getPath("userData"), "desktop-state.json");
}

export function loadState(): DesktopState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<DesktopState>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

let writeTimer: NodeJS.Timeout | null = null;

export function saveState(state: DesktopState, immediate = false): void {
  const write = () => {
    writeTimer = null;
    try {
      mkdirSync(path.dirname(stateFile()), { recursive: true });
      writeFileSync(stateFile(), JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn("[deephaus-desktop] could not persist state", error);
    }
  };
  if (immediate) {
    if (writeTimer) clearTimeout(writeTimer);
    write();
    return;
  }
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(write, 300);
}
