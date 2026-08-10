"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PlanKey } from "@/lib/billing/plans";

export type AppShellUser = {
  welcomeTitle: string;
  plan: PlanKey;
};

const AppShellUserContext = createContext<AppShellUser | null>(null);

export function AppShellUserProvider({
  value,
  children,
}: {
  value: AppShellUser;
  children: ReactNode;
}) {
  return <AppShellUserContext.Provider value={value}>{children}</AppShellUserContext.Provider>;
}

export function useAppShellUser(): AppShellUser {
  const ctx = useContext(AppShellUserContext);
  if (!ctx) throw new Error("AppShellUserProvider required");
  return ctx;
}
