"use client";

import { useEffect, useRef, useState } from "react";
import { HelpLinksPanel, ShortcutsPanel } from "@/components/sidebar-help-menu";
import type { SidebarUser } from "@/components/sidebar";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useSettings } from "@/components/settings/settings-context";
import { useAppShellUser } from "@/lib/client-cache/user-context";
import { teardownPowerSync, waitForPowerSyncUploads } from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";

const THEME_OPTIONS: Array<{ id: Theme; label: string; icon: string }> = [
  { id: "system", label: "System", icon: "ri-computer-line" },
  { id: "light", label: "Light", icon: "ri-sun-line" },
  { id: "dark", label: "Dark", icon: "ri-moon-line" },
];

const PLAN_LABELS: Record<string, string> = { basic: "Basic plan", plus: "Plus plan", pro: "Pro plan" };

type Flyout = "shortcuts" | "help" | null;

type Props = {
  user: SidebarUser;
  collapsed: boolean;
  searchShortcut: string;
  sidebarShortcut: string;
};

function Avatar({ user }: { user: SidebarUser }) {
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        className="notion-sidebar-avatar"
        style={{ objectFit: "cover" }}
        aria-hidden
      />
    );
  }
  return (
    <span className="notion-sidebar-avatar" aria-hidden>
      {user.initials}
    </span>
  );
}

/** Account row at the foot of the sidebar: settings, theme, help and sign out. */
export function SidebarAccountMenu({ user, collapsed, searchShortcut, sidebarShortcut }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<Flyout>(null);
  const [signingOut, setSigningOut] = useState(false);
  const { theme, setTheme } = useTheme();
  const { openSettings } = useSettings();
  const { plan } = useAppShellUser();

  function close() {
    setOpen(false);
    setFlyout(null);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    const uploadsFinished = await waitForPowerSyncUploads();
    if (
      !uploadsFinished &&
      !window.confirm(
        "Your offline changes could not finish syncing. Sign out anyway and discard those unsynced changes?",
      )
    ) {
      setSigningOut(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      window.alert(`Sign out failed: ${error.message}`);
      setSigningOut(false);
      return;
    }
    await teardownPowerSync();
    window.location.href = "/login";
  }

  return (
    <div ref={rootRef} className="dh-account">
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className={`dh-account-menu${collapsed ? " dh-account-menu--collapsed" : ""}`}
        >
          <div className="dh-account-email">{user.email}</div>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            onClick={() => {
              openSettings("account");
              close();
            }}
          >
            <i className="ri-settings-3-line" aria-hidden />
            Settings
          </button>
          <div className="dh-menu-row" style={{ cursor: "default" }}>
            <i className="ri-contrast-2-line" aria-hidden />
            Theme
            <span className="dh-menu-spacer" />
            <span className="dh-seg dh-seg--compact" role="group" aria-label="Theme">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={theme === option.id}
                  onClick={() => setTheme(option.id)}
                >
                  <i className={option.icon} aria-hidden />
                </button>
              ))}
            </span>
          </div>
          <div className="dh-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            aria-expanded={flyout === "shortcuts"}
            onClick={() => setFlyout((value) => (value === "shortcuts" ? null : "shortcuts"))}
          >
            <i className="ri-keyboard-line" aria-hidden />
            Keyboard shortcuts
            <span className="dh-menu-spacer" />
            <i className="ri-arrow-right-s-line" aria-hidden />
          </button>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            aria-expanded={flyout === "help"}
            onClick={() => setFlyout((value) => (value === "help" ? null : "help"))}
          >
            <i className="ri-question-line" aria-hidden />
            Help
            <span className="dh-menu-spacer" />
            <i className="ri-arrow-right-s-line" aria-hidden />
          </button>
          <div className="dh-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            onClick={() => {
              openSettings("billing");
              close();
            }}
          >
            <i className="ri-vip-crown-line" aria-hidden />
            Usage &amp; billing
          </button>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            <i className="ri-logout-box-r-line" aria-hidden />
            Sign out
          </button>

          {flyout ? (
            <div className="dh-account-flyout">
              {flyout === "shortcuts" ? (
                <ShortcutsPanel searchShortcut={searchShortcut} sidebarShortcut={sidebarShortcut} />
              ) : (
                <HelpLinksPanel onNavigate={close} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="dh-account-trigger"
        aria-label={`Account menu for ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Avatar user={user} />
        <span className="dh-account-copy">
          <span className="dh-account-name">{user.name}</span>
          <span className="dh-account-plan">{PLAN_LABELS[plan] ?? "Basic plan"}</span>
        </span>
        <i className="ri-expand-up-down-line" aria-hidden />
      </button>
    </div>
  );
}
