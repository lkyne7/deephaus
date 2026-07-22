"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SettingsOverlay, type SettingsAccount } from "@/components/settings/settings-overlay";

export type SettingsTab =
  | "account"
  | "billing"
  | "university"
  | "appearance"
  | "study"
  | "connections";

const SETTINGS_TABS: SettingsTab[] = [
  "account",
  "billing",
  "university",
  "appearance",
  "study",
  "connections",
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return value !== null && (SETTINGS_TABS as string[]).includes(value);
}

type SettingsContextValue = {
  isOpen: boolean;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("SettingsProvider required");
  return ctx;
}

/**
 * Opens the settings overlay when the URL carries `?settings=<tab>` (used by
 * the /profile redirect and OAuth returnTo round-trips), then strips that
 * param while preserving unrelated flags for their consumers. Recognized
 * billing checkout result flags are also one-shot and removed safely.
 */
function SettingsUrlListener({ onOpen }: { onOpen: (tab: SettingsTab) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("settings");
    if (!isSettingsTab(tab)) return;
    onOpen(tab);
    const rest = new URLSearchParams(searchParams);
    rest.delete("settings");
    if (tab === "billing") {
      for (const key of ["billing", "billing_status", "purchase"]) {
        const value = rest.get(key)?.toLowerCase();
        if (value === "success" || value === "cancelled" || value === "canceled") {
          rest.delete(key);
        }
      }
    }
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, onOpen]);

  return null;
}

export function SettingsProvider({
  account,
  children,
}: {
  account: SettingsAccount;
  children: ReactNode;
}) {
  const [openTab, setOpenTab] = useState<SettingsTab | null>(null);

  const openSettings = useCallback((tab: SettingsTab = "account") => {
    setOpenTab(tab);
  }, []);
  const closeSettings = useCallback(() => setOpenTab(null), []);

  const value = useMemo(
    () => ({ isOpen: openTab !== null, openSettings, closeSettings }),
    [openTab, openSettings, closeSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <SettingsUrlListener onOpen={openSettings} />
      </Suspense>
      <SettingsOverlay
        account={account}
        tab={openTab}
        onTabChange={setOpenTab}
        onClose={closeSettings}
      />
    </SettingsContext.Provider>
  );
}
