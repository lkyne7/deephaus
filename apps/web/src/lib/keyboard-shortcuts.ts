import { useSyncExternalStore } from "react";

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function useModKeyLabel(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (isMacPlatform() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}

/** e.g. ⌘K on Mac, Ctrl+K on Windows. */
export function formatShortcut(mod: string, key: string): string {
  if (mod === "⌘") return `${mod}${key}`;
  return `${mod}+${key}`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"),
  );
}
