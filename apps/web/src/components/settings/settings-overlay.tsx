"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";
import type { SettingsTab } from "@/components/settings/settings-context";
import { AccountSection } from "@/components/settings/account-section";
import { UniversitySection } from "@/components/settings/university-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { StudySection } from "@/components/settings/study-section";
import { ConnectionsSection } from "@/components/settings/connections-section";

export type SettingsAccount = {
  name: string;
  email: string;
  initials: string;
  memberSince: string;
};

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
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour: number;
  lastOptimizedAt: string | null;
  fsrsLogCount: number;
  usableItems: number;
  optimizerMinLogs: number;
};

type NavItem = { id: SettingsTab; label: string; icon: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Account",
    items: [
      { id: "account", label: "Account", icon: "ri-user-3-line" },
      { id: "university", label: "University", icon: "ri-graduation-cap-line" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", icon: "ri-palette-line" },
      { id: "study", label: "Study", icon: "ri-equalizer-line" },
    ],
  },
  {
    label: "Integrations",
    items: [{ id: "connections", label: "Connections", icon: "ri-plug-line" }],
  },
];

const TAB_TITLES: Record<SettingsTab, string> = {
  account: "Account",
  university: "University",
  appearance: "Appearance",
  study: "Study",
  connections: "Connections",
};

type Props = {
  account: SettingsAccount;
  tab: SettingsTab | null;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
};

export function SettingsOverlay({ account, tab, onTabChange, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const open = tab !== null;

  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [study, setStudy] = useState<SettingsStudyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    if (!open) return;
    void loadData();
  }, [open, loadData]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence mode="wait">
      {open && (
        <m.div
          key="settings-overlay"
          style={s.backdrop}
          onClick={onClose}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
        >
          <m.div
            style={s.panel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={motionTransition(undefined, undefined, reducedMotion ?? false)}
          >
            <nav style={s.nav} aria-label="Settings sections">
              <div style={s.navUser}>
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="" style={s.navAvatarImg} />
                ) : (
                  <span style={s.navAvatar}>{account.initials}</span>
                )}
                <div style={s.navUserText}>
                  <span style={s.navUserName}>{profile?.full_name || account.name}</span>
                  <span style={s.navUserEmail}>{account.email}</span>
                </div>
              </div>
              {NAV_GROUPS.map((group) => (
                <div key={group.label} style={s.navGroup}>
                  <span style={s.navGroupLabel}>{group.label}</span>
                  {group.items.map((item) => {
                    const active = item.id === tab;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onTabChange(item.id)}
                        aria-current={active ? "page" : undefined}
                        style={{
                          ...s.navItem,
                          background: active ? "var(--bg-surface-3, rgba(0,0,0,0.06))" : "transparent",
                          color: active ? "var(--fg-primary)" : "var(--fg-secondary)",
                          fontWeight: active ? 600 : 500,
                        }}
                      >
                        <i className={item.icon} style={s.navItemIcon} aria-hidden />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div style={s.content}>
              <div style={s.contentHead}>
                <h2 style={s.contentTitle}>{TAB_TITLES[tab]}</h2>
                <button type="button" onClick={onClose} style={s.closeBtn} aria-label="Close settings">
                  <i className="ri-close-line" />
                </button>
              </div>

              {loadError ? (
                <div style={s.loadError}>
                  <span>{loadError}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadData()}>
                    Retry
                  </button>
                </div>
              ) : null}

              <div style={s.contentBody}>
                {tab === "account" ? (
                  <AccountSection
                    account={account}
                    profile={profile}
                    onProfileUpdated={setProfile}
                    onClose={onClose}
                  />
                ) : null}
                {tab === "university" ? (
                  <UniversitySection profile={profile} onProfileUpdated={setProfile} />
                ) : null}
                {tab === "appearance" ? <AppearanceSection /> : null}
                {tab === "study" ? (
                  <StudySection
                    study={study}
                    onStudyUpdated={(patch) =>
                      setStudy((current) => (current ? { ...current, ...patch } : current))
                    }
                  />
                ) : null}
                {tab === "connections" ? <ConnectionsSection /> : null}
              </div>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function SettingsLoadingState({ label }: { label: string }) {
  return (
    <div style={s.loadingState}>
      <i className="ri-loader-4-line icon-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 100,
  },
  panel: {
    display: "flex",
    width: "min(1040px, 100%)",
    height: "min(720px, 100%)",
    background: "var(--white)",
    borderRadius: 12,
    border: "1px solid var(--border-2)",
    boxShadow: "var(--shadow-xl)",
    overflow: "hidden",
  },
  nav: {
    width: 232,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "16px 10px",
    background: "var(--bg-surface-2)",
    borderRight: "1px solid var(--border-secondary)",
    overflowY: "auto",
  },
  navUser: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 8px",
  },
  navAvatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--brand-500)",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 13px/1 var(--font-sans)",
    flexShrink: 0,
  },
  navAvatarImg: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  navUserText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  navUserName: {
    font: "600 13px/18px var(--font-sans)",
    color: "var(--fg-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  navUserEmail: {
    font: "400 11px/15px var(--font-sans)",
    color: "var(--fg-quaternary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  navGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  navGroupLabel: {
    font: "600 11px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0 8px 4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 8px",
    border: 0,
    borderRadius: 6,
    background: "transparent",
    font: "500 13.5px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
  navItemIcon: {
    fontSize: 16,
    width: 18,
    textAlign: "center",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  },
  contentHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "20px 32px 0",
  },
  contentTitle: {
    margin: 0,
    font: "600 20px/28px var(--font-sans)",
    color: "var(--fg-primary)",
    letterSpacing: "-0.01em",
  },
  closeBtn: {
    border: 0,
    background: "transparent",
    fontSize: 20,
    color: "var(--fg-quaternary)",
    cursor: "pointer",
    padding: 4,
    lineHeight: 1,
  },
  contentBody: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "20px 32px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  loadError: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    margin: "16px 32px 0",
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--grade-again-bg, #fef2f2)",
    border: "1px solid var(--grade-again-border, #fecaca)",
    color: "var(--grade-again)",
    font: "500 13px/18px var(--font-sans)",
  },
  loadingState: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "24px 0",
    color: "var(--fg-tertiary)",
    font: "400 13px/18px var(--font-sans)",
  },
};
