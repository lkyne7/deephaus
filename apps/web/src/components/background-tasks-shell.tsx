"use client";

import type { ReactNode } from "react";
import { BackgroundTasksBanner } from "@/components/background-tasks-banner";
import { BackgroundTasksProvider } from "@/lib/background-tasks/context";

export function BackgroundTasksShell({ children }: { children: ReactNode }) {
  return (
    <BackgroundTasksProvider>
      {children}
      <BackgroundTasksBanner />
    </BackgroundTasksProvider>
  );
}
