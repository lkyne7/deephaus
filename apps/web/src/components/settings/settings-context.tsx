"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { settingsPath, type SettingsTab } from "@/lib/settings/tabs";

export type { SettingsTab };

export type SettingsAccount = {
  id: string;
  name: string;
  email: string;
  initials: string;
  memberSince: string;
};

type SettingsContextValue = {
  account: SettingsAccount;
  openSettings: (tab?: SettingsTab) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("SettingsProvider required");
  return ctx;
}

export function SettingsProvider({
  account,
  children,
}: {
  account: SettingsAccount;
  children: ReactNode;
}) {
  const router = useRouter();

  const openSettings = useCallback(
    (tab: SettingsTab = "account") => router.push(settingsPath(tab)),
    [router],
  );

  const value = useMemo(() => ({ account, openSettings }), [account, openSettings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
