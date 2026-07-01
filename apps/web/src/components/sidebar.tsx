"use client";

import Link from "next/link";
import { m, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { createClient } from "@/lib/supabase/client";
import { formatShortcut, isTypingTarget, useModKeyLabel } from "@/lib/keyboard-shortcuts";
import { BrandMark } from "@/components/brand-mark";
import { SidebarPanelIcon } from "@/components/ui/sidebar-panel-icon";
import { useCardSearch } from "@/lib/card-search/context";
import { prefetchRouteData } from "@/lib/client-cache/prefetch";
import { SidebarHelpMenu } from "@/components/sidebar-help-menu";
import { useTheme } from "@/components/theme-provider";
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
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "ri-home-4-line",
    iconActive: "ri-home-4-fill",
  },
  {
    id: "decks",
    label: "Decks",
    href: "/study",
    icon: "ri-folder-3-line",
    iconActive: "ri-folder-3-fill",
  },
  { id: "create", label: "Create", href: "/decks/new", icon: "ri-add-line", iconActive: "ri-add-fill" },
  { id: "browse", label: "Browse", href: "/decks", icon: "ri-stack-line", iconActive: "ri-stack-fill" },
  {
    id: "community",
    label: "Community",
    href: "/community",
    icon: "ri-group-line",
    iconActive: "ri-group-fill",
  },
];

const STORAGE_KEY = "deephaus.sidebar.collapsed";
const COLLAPSE_EVENT = "deephaus.sidebar.collapsed.change";
const WIDTH_EXPANDED = 260;
const WIDTH_COLLAPSED = 56;

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
};

function sidebarTransition(reducedMotion: boolean) {
  return motionTransition(0.26, motionTokens.easeOut, reducedMotion);
}

function SidebarHoverLabel({
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
  className = "",
}: {
  collapsed: boolean;
  href: string;
  label: string;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      prefetch
      onMouseEnter={() => prefetchRouteData(href)}
      onFocus={() => prefetchRouteData(href)}
      aria-label={label}
      className={`notion-sidebar-item${active ? " notion-sidebar-item--active" : ""}${className ? ` ${className}` : ""}`}
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

function SidebarThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Light mode" : "Dark mode";
  const icon = isDark ? "ri-sun-line" : "ri-moon-line";

  return (
    <SidebarNavButton collapsed={collapsed} label={label} onClick={toggleTheme}>
      <i className={icon} aria-hidden />
      <span className="notion-sidebar-item-label">{label}</span>
    </SidebarNavButton>
  );
}

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const { openSearch } = useCardSearch();
  const { mutate } = useSWRConfig();
  const reducedMotion = useReducedMotion();
  const transition = sidebarTransition(reducedMotion ?? false);
  const [signingOut, setSigningOut] = useState(false);
  const modKey = useModKeyLabel();
  const sidebarShortcut = formatShortcut(modKey, ".");
  const searchShortcut = formatShortcut(modKey, "K");

  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );

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
    if (href === "/study") {
      if (pathname === "/study") return true;
      // Deck detail / study session — not create, import, or browse roots.
      const deckMatch = /^\/decks\/([^/]+)(?:\/study)?$/.exec(pathname);
      if (!deckMatch) return false;
      const segment = deckMatch[1];
      return segment !== "new" && segment !== "import";
    }
    if (href === "/decks") return pathname === "/decks";
    if (href === "/decks/new") {
      return pathname === "/decks/new" || pathname === "/decks/import";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleSignOut() {
    setSigningOut(true);
    await mutate(() => true, undefined, { revalidate: false });
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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
        {!collapsed && (
          <Link href="/dashboard" className="notion-sidebar-workspace" title="DeepHaus">
            <BrandMark size={22} style={{ color: "var(--fg-primary)", flexShrink: 0 }} />
            <span className="notion-sidebar-workspace-name">DeepHaus</span>
          </Link>
        )}
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

      <div className="notion-sidebar-utilities">
        <SidebarHelpMenu
          collapsed={collapsed}
          modKey={modKey}
          searchShortcut={searchShortcut}
          sidebarShortcut={sidebarShortcut}
        />
        <SidebarThemeToggle collapsed={collapsed} />
      </div>

      <div className="notion-sidebar-footer">
        <SidebarNavLink
          collapsed={collapsed}
          href="/profile"
          label="Profile"
          active={pathname.startsWith("/profile")}
        >
          <span className="notion-sidebar-avatar" aria-hidden>
            {user.initials}
          </span>
          <span className="notion-sidebar-item-label">{user.name}</span>
        </SidebarNavLink>
        {!collapsed && (
          <button
            type="button"
            className="notion-sidebar-icon-btn"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <i className="ri-logout-box-r-line" aria-hidden />
          </button>
        )}
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
