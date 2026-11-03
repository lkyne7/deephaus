"use client";

import { useSyncExternalStore } from "react";
import { getDesktopBridge, type DesktopBridge } from "@deephaus/shared";

const noop = () => () => {};

/**
 * The Electron preload installs the bridge before any page script runs, so the
 * value never changes after hydration; `null` on the server and in browsers.
 */
export function useDesktopBridge(): DesktopBridge | null {
  return useSyncExternalStore(noop, getDesktopBridge, () => null);
}
