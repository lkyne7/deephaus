"use client";

import Link from "next/link";
import { AnimatePresence, m, useReducedMotion, type Transition } from "motion/react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { formatShortcut, isTypingTarget, useModKeyLabel } from "@/lib/keyboard-shortcuts";
import { BrandMark } from "@/components/brand-mark";
import { SidebarPanelIcon } from "@/components/ui/sidebar-panel-icon";
import { useCardSearch } from "@/lib/card-search/context";
import { prefetchRouteData } from "@/lib/client-cache/prefetch";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { motionTokens, motionTransition } from "@/lib/motion";

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
  iconActive: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "Home",
    href: "/dashboard",
    icon: "ri-home-5-line",
    iconActive: "ri-home-5-fill",
  },
  { id: "create", label: "Create", href: "/create", icon: "ri-add-line", iconActive: "ri-add-fill" },
  {
    id: "decks",
    label: "Decks",
    href: "/decks",
    icon: "ri-folder-3-line",
    iconActive: "ri-folder-3-fill",
  },
  { id: "cards", label: "Cards", href: "/cards", icon: "ri-stack-line", iconActive: "ri-stack-fill" },
  {
    id: "cram",
    label: "Cram",
    href: "/cram",
    icon: "ri-flashlight-line",
    iconActive: "ri-flashlight-fill",
  },
  {
    id: "community",
    label: "Community",
    href: "/community",
    icon: "ri-group-line",
    iconActive: "ri-group-fill",
  },
  {
    id: "insights",
    label: "Insights",
    href: "/insights",
    icon: "ri-bar-chart-2-line",
    iconActive: "ri-bar-chart-2-fill",
  },
];

const RECENT_DECK_COUNT = 6;

const STORAGE_KEY = "deephaus.sidebar.collapsed";
const COLLAPSE_EVENT = "deephaus.sidebar.collapsed.change";
const WIDTH_EXPANDED = 272;
const WIDTH_COLLAPSED = 55;

function subscribeSidebarCollapsed(onStoreChange: () => void) {
  const handler = (event: Event) => {
    if (event.type === COLLAPSE_EVENT) {
      onStoreChange();
      return;
    }
    const storageEvent = event as StorageEvent;
    if (storageEvent.key === STORAGE_KEY || storageEvent.key === null) onStoreChange();
  };
  window.addEventListener(COLLAPSE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSidebarCollapsedSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getSidebarCollapsedServerSnapshot() {
  return false;
}

export type SidebarUser = {
  name: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
};

function sidebarTransition(reducedMotion: boolean) {
  return motionTransition(motionTokens.duration.base, motionTokens.ease, reducedMotion);
}

export function SidebarHoverLabel({
  collapsed,
  label,
  shortcut,
  showWhenExpanded = false,
}: {
  collapsed: boolean;
  label: string;
  shortcut?: string;
  showWhenExpanded?: boolean;
}) {
  if (!collapsed && !showWhenExpanded) return null;
  return (
    <span
      className={`notion-sidebar-hover-label${showWhenExpanded ? " notion-sidebar-hover-label--always" : ""}`}
      role="tooltip"
      aria-hidden
    >
      <span className="notion-sidebar-hover-label-text">{label}</span>
      {shortcut ? <span className="notion-sidebar-hover-shortcut">{shortcut}</span> : null}
    </span>
  );
}

function SidebarNavLink({
  collapsed,
  href,
  label,
  active,
  children,
}: {
  collapsed: boolean;
  href: string;
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch
      onMouseEnter={() => prefetchRouteData(href)}
      onFocus={() => prefetchRouteData(href)}
      aria-label={label}
      className={`notion-sidebar-item${active ? " notion-sidebar-item--active" : ""}`}
    >
      <SidebarHoverLabel collapsed={collapsed} label={label} />
      {children}
    </Link>
  );
}

function SidebarNavButton({
  collapsed,
  label,
  shortcut,
  onClick,
  children,
}: {
  collapsed: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        e.currentTarget.blur();
      }}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      className="notion-sidebar-item"
    >
      <SidebarHoverLabel collapsed={collapsed} label={label} shortcut={shortcut} />
      {children}
    </button>
  );
}

/** Most recently reviewed decks, with whatever is still due today. */
function SidebarRecents({ transition }: { transition: Transition }) {
  const { data: stats } = useDashboardStats();
  const pathname = usePathname();
  const decks = useMemo(
    () =>
      [...(stats?.per_deck ?? [])]
        .sort((a, b) => (b.last_reviewed ?? "").localeCompare(a.last_reviewed ?? ""))
        .slice(0, RECENT_DECK_COUNT),
    [stats],
  );

  return (
    <m.div
      className="notion-sidebar-recents"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
    >
      <div className="notion-sidebar-section-label">Recents</div>
      {decks.length === 0 ? (
        <p className="notion-sidebar-recents-empty">Your decks will show up here.</p>
      ) : (
        decks.map((deck) => {
          const href = `/decks/${deck.deck_id}`;
          return (
            <Link
              key={deck.deck_id}
              href={href}
              onMouseEnter={() => prefetchRouteData(href)}
              className={`notion-sidebar-recent${pathname === href ? " is-active" : ""}`}
            >
              <span className="notion-sidebar-recent-name">{deck.name}</span>
              {deck.due > 0 ? <span className="notion-sidebar-recent-count">{deck.due}</span> : null}
            </Link>
          );
        })
      )}
    </m.div>
  );
}

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const { openSearch } = useCardSearch();
  const reducedMotion = useReducedMotion();
  const transition = sidebarTransition(reducedMotion ?? false);
  const fadeTransition = motionTransition(motionTokens.duration.fast, motionTokens.ease, reducedMotion ?? false);
  const modKey = useModKeyLabel();
  const sidebarShortcut = formatShortcut(modKey, ".");
  const searchShortcut = formatShortcut(modKey, "K");

  const storedCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );
  // Study sessions fold to the icon rail without changing the saved preference.
  const inStudySession = /^\/(?:decks|cram)\/[^/]+\/study$/.test(pathname) || pathname === "/review";
  const collapsed = storedCollapsed || inStudySession;

  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!getSidebarCollapsedSnapshot());
  }, [setCollapsed]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ".") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggleCollapsed();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    if (href === "/decks") {
      if (pathname === "/decks") return true;
      // Deck detail / study session — not create or cards.
      return /^\/decks\/[^/]+(?:\/study)?$/.test(pathname);
    }
    if (href === "/cards") return pathname === "/cards" || pathname.startsWith("/cards/");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <m.aside
      className={`notion-sidebar${collapsed ? " notion-sidebar--collapsed" : ""}`}
      style={s.root}
      initial={false}
      animate={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
      transition={transition}
    >
      <div
        className={`notion-sidebar-header${collapsed ? " notion-sidebar-header--collapsed" : ""}`}
      >
        <Link href="/dashboard" className="notion-sidebar-workspace dh-eq dh-eq-hover" title="DeepHaus">
          <span className="notion-sidebar-workspace-icon" aria-hidden>
            <BrandMark size={24} style={{ color: "var(--fg-primary)" }} title={null} />
          </span>
          <span className="notion-sidebar-workspace-name dh-wordmark">DeepHaus</span>
        </Link>
        <button
          type="button"
          className="notion-sidebar-icon-btn notion-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={`${collapsed ? "Open sidebar" : "Close sidebar"} (${sidebarShortcut})`}
          aria-expanded={!collapsed}
          aria-keyshortcuts="Meta+Period Control+Period"
        >
          <SidebarHoverLabel
            collapsed={collapsed}
            showWhenExpanded
            label={collapsed ? "Open sidebar" : "Close sidebar"}
            shortcut={sidebarShortcut}
          />
          <SidebarPanelIcon />
        </button>
      </div>

      <nav className="notion-sidebar-nav" aria-label="Main">
        <SidebarNavButton
          collapsed={collapsed}
          label="Search"
          shortcut={searchShortcut}
          onClick={openSearch}
        >
          <i className="ri-search-line" aria-hidden />
          <span className="notion-sidebar-item-label">Search</span>
          <kbd className="notion-sidebar-kbd">{searchShortcut}</kbd>
        </SidebarNavButton>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <SidebarNavLink
              key={item.id}
              collapsed={collapsed}
              href={item.href}
              label={item.label}
              active={active}
            >
              <i className={active ? item.iconActive : item.icon} aria-hidden />
              <span className="notion-sidebar-item-label">{item.label}</span>
            </SidebarNavLink>
          );
        })}
      </nav>

      <div className="notion-sidebar-spacer">
        <AnimatePresence initial={false}>
          {collapsed ? null : <SidebarRecents transition={fadeTransition} />}
        </AnimatePresence>
      </div>

      <div className="notion-sidebar-footer">
        <SidebarAccountMenu
          user={user}
          collapsed={collapsed}
          searchShortcut={searchShortcut}
          sidebarShortcut={sidebarShortcut}
        />
      </div>
    </m.aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: "100vh",
    maxHeight: "100vh",
    alignSelf: "flex-start",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    overflow: "visible",
  },
};
