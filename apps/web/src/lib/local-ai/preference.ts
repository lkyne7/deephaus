"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getDesktopBridge, parseLocalAiEngine, type LocalAiEngine } from "@deephaus/shared";

/** Per device: each computer has its own CLIs and sign-ins. */
const STORAGE_KEY = "deephaus.generationEngine";
const CHANGE_EVENT = "deephaus:generation-engine";

function readStoredEngine(): LocalAiEngine | null {
  if (typeof window === "undefined") return null;
  try {
    return parseLocalAiEngine(window.localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** The engine new generation runs should use; `null` means DeepHaus credits. */
export function selectedLocalEngine(): LocalAiEngine | null {
  return getDesktopBridge()?.ai ? readStoredEngine() : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLocalEngine() {
  const engine = useSyncExternalStore(subscribe, selectedLocalEngine, () => null);
  const setEngine = useCallback((next: LocalAiEngine | null) => {
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the choice then lasts for this render only.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [engine, setEngine] as const;
}
