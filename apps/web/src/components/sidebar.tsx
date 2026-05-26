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

  return (
    <aside
      style={{
        ...s.root,
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
      }}
    >
      <div
        style={{
          ...s.brand,
          flexDirection: collapsed ? "column" : "row",
          padding: collapsed ? "16px 12px 12px" : "16px 16px 12px",
          gap: collapsed ? 8 : 10,
        }}
      >
        <Link
          href="/dashboard"
          title="DeepHaus dashboard"
          style={{
            ...s.brandLink,
            justifyContent: collapsed ? "center" : "flex-start",
            flex: collapsed ? undefined : 1,
            minWidth: 0,
          }}
        >
          <BrandMark size={28} style={{ color: "var(--fg-primary)", flexShrink: 0 }} />
          {!collapsed && <span style={s.brandText}>DeepHaus</span>}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={s.collapseBtn}
        >
          <i className={collapsed ? "ri-menu-unfold-line" : "ri-menu-fold-line"} />
        </button>
      </div>

      <nav style={{ ...s.nav, padding: collapsed ? "8px 10px" : "8px 12px" }}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              title={collapsed ? item.label : undefined}
              style={{
                ...s.item,
                ...(active ? s.itemActive : {}),
                ...(collapsed
                  ? {
                      justifyContent: "center",
                      padding: "10px 0",
                      gap: 0,
                    }
                  : {}),
              }}
            >
              <i className={active ? item.iconActive : item.icon} style={s.itemIcon} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div
        style={{
          ...s.userPill,
          flexDirection: collapsed ? "column" : "row",
          margin: collapsed ? "0 10px 12px" : "0 12px 16px",
          padding: collapsed ? "12px 8px" : "12px 16px",
          gap: collapsed ? 10 : 8,
        }}
      >
        <div style={s.avatar} title={user.name}>
          {user.initials}
        </div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.userName}>{user.name}</div>
            <div style={s.userEmail}>{user.email}</div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexDirection: collapsed ? "column" : "row",
          }}
        >
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
    minHeight: "100vh",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border-secondary)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    transition: "width 180ms ease",
    overflow: "hidden",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    color: "var(--fg-primary)",
  },
  brandLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "inherit",
    textDecoration: "none",
    borderRadius: 8,
    minWidth: 0,
  },
  brandText: {
    font: "600 18px/1 var(--font-sans)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  collapseBtn: {
    background: "transparent",
    border: 0,
    padding: 6,
    borderRadius: 8,
    color: "var(--fg-quaternary)",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  nav: { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "transparent",
    color: "var(--fg-tertiary)",
    borderRadius: 9999,
    font: "500 14px/20px var(--font-sans)",
    textDecoration: "none",
  },
  itemActive: { background: "var(--bg-surface-2)", color: "var(--fg-primary)" },
  itemIcon: { fontSize: 18, width: 20, textAlign: "center", flexShrink: 0 },
  userPill: {
    display: "flex",
    alignItems: "center",
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
