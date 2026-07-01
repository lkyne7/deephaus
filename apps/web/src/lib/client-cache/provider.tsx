"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { appSwrConfig } from "@/lib/client-cache/config";

/** Mounts shared SWR defaults. Route prefetch runs from sidebar hover — not on every navigation. */
export function AppDataProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  return (
    <SWRConfig
      key={userId}
      value={{
        ...appSwrConfig,
        provider: () => new Map(),
      }}
    >
      {children}
    </SWRConfig>
  );
}
