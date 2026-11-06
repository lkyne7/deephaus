"use client";

import "./settings.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { EasyDays } from "@deephaus/shared";
import { useOfflineLibrary } from "@/components/offline-library";
import { SETTINGS_TABS, SETTINGS_TAB_LABELS, settingsPath } from "@/lib/settings/tabs";

export type SettingsProfile = {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  university_name: string | null;
  university_domain: string | null;
  university_email: string | null;
  university_email_verified_at: string | null;
};

export type SettingsStudyData = {
  easyDays?: EasyDays;
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour: number;
  lastOptimizedAt: string | null;
  fsrsLogCount: number;
  usableItems: number;
  optimizerMinLogs: number;
};

type SettingsData = {
  profile: SettingsProfile | null;
  setProfile: (profile: SettingsProfile) => void;
  study: SettingsStudyData | null;
  patchStudy: (patch: Partial<SettingsStudyData>) => void;
  /** Null until hydrated: the offline library only exists in the browser. */
  offlineAvailable: boolean | null;
};

const SettingsDataContext = createContext<SettingsData | null>(null);

export function useSettingsData(): SettingsData {
  const ctx = useContext(SettingsDataContext);
  if (!ctx) throw new Error("SettingsShell required");
  return ctx;
}

/** Owns the profile and study data so switching tabs doesn't refetch them. */
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const offlineLibrary = useOfflineLibrary();

  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [study, setStudy] = useState<SettingsStudyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const offlineAvailable = hydrated ? Boolean(offlineLibrary) : null;

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [profileRes, studyRes] = await Promise.all([
        fetch("/api/profile", { credentials: "include" }),
        fetch("/api/fsrs/settings", { credentials: "include" }),
      ]);
      if (!profileRes.ok) throw new Error("Could not load your profile");
      if (!studyRes.ok) throw new Error("Could not load study settings");
      const profileBody = (await profileRes.json()) as SettingsProfile;
      const studyBody = (await studyRes.json()) as SettingsStudyData;
      setProfile(profileBody);
      setStudy({
        easyDays: studyBody.easyDays,
        desiredRetention: studyBody.desiredRetention,
        newCardsPerDay: studyBody.newCardsPerDay,
        dayStartHour: studyBody.dayStartHour,
        lastOptimizedAt: studyBody.lastOptimizedAt ?? null,
        fsrsLogCount: studyBody.fsrsLogCount ?? 0,
        usableItems: studyBody.usableItems ?? 0,
        optimizerMinLogs: studyBody.optimizerMinLogs ?? 100,
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load settings");
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const data = useMemo(
    () => ({
      profile,
      setProfile,
      study,
      patchStudy: (patch: Partial<SettingsStudyData>) =>
        setStudy((current) => (current ? { ...current, ...patch } : current)),
      offlineAvailable,
    }),
    [profile, study, offlineAvailable],
  );

  const tabs = SETTINGS_TABS.filter((tab) => tab !== "downloads" || offlineAvailable);

  return (
    <SettingsDataContext.Provider value={data}>
      <div className="dhs-page">
        <div className="dhs-rail">
          <h1 className="dh-title">Settings</h1>
          <nav className="dhs-nav" aria-label="Settings sections">
            {tabs.map((tab) => {
              const href = settingsPath(tab);
              return (
                <Link key={tab} href={href} aria-current={pathname === href ? "page" : undefined}>
                  {SETTINGS_TAB_LABELS[tab]}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="dhs-content">
          {loadError ? (
            <div className="dhs-banner dhs-banner--error" role="alert">
              <span>{loadError}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadData()}>
                Retry
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </SettingsDataContext.Provider>
  );
}

export function SettingsLoadingState({ label }: { label: string }) {
  return (
    <div className="dhs-loading">
      <i className="ri-loader-4-line icon-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
