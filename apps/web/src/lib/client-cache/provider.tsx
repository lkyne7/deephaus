"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { appSwrConfig } from "@/lib/client-cache/config";

/** Mounts shared SWR defaults. Route prefetch runs from sidebar hover — not on every navigation. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={appSwrConfig}>{children}</SWRConfig>;
}
