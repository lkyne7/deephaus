"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
  iconActive: string;
};

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ri-home-4-line", iconActive: "ri-home-4-fill" },
  { id: "create", label: "Create", href: "/decks/new", icon: "ri-add-circle-line", iconActive: "ri-add-circle-fill" },
  { id: "browse", label: "Browse", href: "/decks", icon: "ri-folder-line", iconActive: "ri-folder-fill" },
  { id: "review", label: "Review", href: "/review", icon: "ri-book-open-line", iconActive: "ri-book-open-fill" },
  { id: "profile", label: "Profile", href: "/profile", icon: "ri-user-line", iconActive: "ri-user-fill" },
];

const STORAGE_KEY = "deephaus.sidebar.collapsed";
const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 72;

export type SidebarUser = {
  name: string;
  email: string;
  initials: string;
};

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      // ignore
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    if (href === "/decks") {
      return pathname === "/decks" || (pathname.startsWith("/decks/") && !pathname.startsWith("/decks/new"));
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const shellState = collapsed ? "sidebar-shell--collapsed" : "sidebar-shell--expanded";

  return (
    <aside
      className={`sidebar-shell ${shellState}`}
      style={{
        ...s.root,
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
      }}
    >
      <div
        className={`app-chrome-bar sidebar-shell__brand ${shellState}`}
        style={{
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "0 10px" : "0 16px",
          gap: 10,
          position: "relative",
        }}
      >
        <Link
          href="/dashboard"
          title="DeepHaus dashboard"
          aria-hidden={collapsed}
          tabIndex={collapsed ? -1 : 0}
          className={`sidebar-shell__brand-link ${shellState}`}
          style={s.brandLink}
        >
          <BrandMark size={28} style={{ color: "var(--fg-primary)", flexShrink: 0 }} />
          <span className={`sidebar-shell__brand-text ${shellState}`} style={s.brandText}>
            DeepHaus
          </span>
        </Link>

        <button
          type="button"
          onClick={toggleCollapsed}
          className={`sidebar-shell__toggle ${shellState}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <i className={`ri-menu-fold-line ${collapsed ? "is-hidden" : "is-visible"}`} />
          <i className={`ri-menu-unfold-line ${collapsed ? "is-visible" : "is-hidden"}`} />
        </button>
      </div>

      <nav className={`sidebar-shell__nav ${shellState}`} style={{ ...s.nav, padding: collapsed ? "8px 10px" : "8px 12px" }}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`sidebar-shell__nav-item ${shellState}`}
              style={{
                ...s.item,
                ...(active ? s.itemActive : {}),
                justifyContent: collapsed ? "center" : "flex-start",
                padding: collapsed ? "10px 0" : "10px 14px",
                gap: collapsed ? 0 : 12,
              }}
            >
              <i className={active ? item.iconActive : item.icon} style={s.itemIcon} />
              <span className={`sidebar-shell__nav-label ${shellState}`}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div
        className={`sidebar-shell__user-footer ${shellState}`}
        style={{
          ...s.userFooter,
          flexDirection: collapsed ? "column" : "row",
          padding: collapsed ? "12px 10px" : "12px 16px",
          gap: collapsed ? 10 : 8,
        }}
      >
        <div style={s.avatar} title={user.name}>
          {user.initials}
        </div>
        <div className={`sidebar-shell__user-meta ${shellState}`}>
          <div style={s.userName}>{user.name}</div>
          <div style={s.userEmail}>{user.email}</div>
        </div>
        <div className={`sidebar-shell__user-actions ${shellState}`}>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
            style={s.logoutBtn}
          >
            <i className="ri-logout-box-r-line" />
          </button>
        </div>
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: "100vh",
    maxHeight: "100vh",
    alignSelf: "flex-start",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border-secondary)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    overflow: "hidden",
  },
  brandLink: {
    color: "inherit",
    textDecoration: "none",
    borderRadius: 8,
  },
  brandText: {
    font: "600 18px/1 var(--font-sans)",
  },
  nav: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0, overflowY: "auto" },
  item: {
    display: "flex",
    alignItems: "center",
    background: "transparent",
    color: "var(--fg-tertiary)",
    borderRadius: 9999,
    font: "500 14px/20px var(--font-sans)",
    textDecoration: "none",
  },
  itemActive: { background: "var(--bg-surface-2)", color: "var(--fg-primary)" },
  itemIcon: { fontSize: 18, width: 20, textAlign: "center", flexShrink: 0 },
  userFooter: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    marginTop: "auto",
    borderTop: "1px solid var(--border-secondary)",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--brand-500)",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "500 12px/1 var(--font-sans)",
    flexShrink: 0,
  },
  userName: {
    font: "500 13px/16px var(--font-sans)",
    color: "var(--fg-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  userEmail: {
    font: "400 11px/14px var(--font-sans)",
    color: "var(--fg-quaternary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  logoutBtn: {
    background: "transparent",
    border: 0,
    padding: 6,
    borderRadius: 6,
    color: "var(--fg-quaternary)",
    fontSize: 16,
    cursor: "pointer",
  },
};
