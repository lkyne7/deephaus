"use client";

import Link from "next/link";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";
import { motionTokens, motionTransition } from "@/lib/motion";

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
  { id: "community", label: "Community", href: "/community", icon: "ri-community-line", iconActive: "ri-community-fill" },
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

function sidebarTransition(reducedMotion: boolean) {
  return motionTransition(motionTokens.duration.base, motionTokens.ease, reducedMotion);
}

function CollapseLabel({
  collapsed,
  children,
  maxWidth = 120,
}: {
  collapsed: boolean;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <m.span
      style={{ whiteSpace: "nowrap", overflow: "hidden", display: "inline-block" }}
      initial={false}
      animate={{
        opacity: collapsed ? 0 : 1,
        x: collapsed ? -6 : 0,
        maxWidth: collapsed ? 0 : maxWidth,
      }}
      transition={sidebarTransition(reducedMotion ?? false)}
    >
      {children}
    </m.span>
  );
}

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const transition = sidebarTransition(reducedMotion ?? false);
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
    <m.aside
      style={s.root}
      initial={false}
      animate={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
      transition={transition}
    >
      <m.div
        className="app-chrome-bar"
        style={s.brandBar}
        initial={false}
        animate={{
          justifyContent: collapsed ? "center" : "flex-start",
          paddingLeft: collapsed ? 10 : 16,
          paddingRight: collapsed ? 10 : 16,
        }}
        transition={transition}
      >
        <m.div
          initial={false}
          animate={{
            opacity: collapsed ? 0 : 1,
            x: collapsed ? -6 : 0,
            maxWidth: collapsed ? 0 : 180,
            flex: collapsed ? "0 0 auto" : "1 1 auto",
          }}
          transition={transition}
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          <Link
            href="/dashboard"
            title="DeepHaus dashboard"
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            style={{
              ...s.brandLink,
              pointerEvents: collapsed ? "none" : "auto",
            }}
          >
            <BrandMark size={28} style={{ color: "var(--fg-primary)", flexShrink: 0 }} />
            <CollapseLabel collapsed={collapsed} maxWidth={120}>
              <span style={s.brandText}>DeepHaus</span>
            </CollapseLabel>
          </Link>
        </m.div>

        <m.div
          initial={false}
          animate={{ marginLeft: collapsed ? 0 : "auto" }}
          transition={transition}
          style={{ display: "flex" }}
        >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={s.toggleBtn}
        >
          <AnimatePresence mode="wait" initial={false}>
            {collapsed ? (
              <m.i
                key="unfold"
                className="ri-menu-unfold-line"
                style={s.toggleIcon}
                initial={{ opacity: 0, scale: 0.92, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.92, rotate: 8 }}
                transition={transition}
              />
            ) : (
              <m.i
                key="fold"
                className="ri-menu-fold-line"
                style={s.toggleIcon}
                initial={{ opacity: 0, scale: 0.92, rotate: 8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.92, rotate: -8 }}
                transition={transition}
              />
            )}
          </AnimatePresence>
        </button>
        </m.div>
      </m.div>

      <m.nav
        style={s.nav}
        initial={false}
        animate={{ paddingLeft: collapsed ? 10 : 12, paddingRight: collapsed ? 10 : 12 }}
        transition={transition}
      >
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`sidebar-nav-item${active ? " sidebar-nav-item--active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  ...s.item,
                  justifyContent: collapsed ? "center" : "flex-start",
                  paddingLeft: collapsed ? 10 : 14,
                  paddingRight: collapsed ? 10 : 14,
                }}
              >
                <span style={s.iconSlot} aria-hidden>
                  <i className={active ? item.iconActive : item.icon} style={s.iconGlyph} />
                </span>
                <m.span
                  style={{
                    ...s.labelSlot,
                    marginLeft: collapsed ? 0 : 16,
                  }}
                  initial={false}
                  animate={{
                    opacity: collapsed ? 0 : 1,
                    maxWidth: collapsed ? 0 : 140,
                  }}
                  transition={transition}
                >
                  {item.label}
                </m.span>
              </div>
            </Link>
          );
        })}
      </m.nav>

      <m.div
        style={s.userFooter}
        initial={false}
        animate={{
          flexDirection: collapsed ? "column" : "row",
          paddingLeft: collapsed ? 10 : 16,
          paddingRight: collapsed ? 10 : 16,
          gap: collapsed ? 10 : 8,
        }}
        transition={transition}
      >
        <div style={s.avatar} title={user.name}>
          {user.initials}
        </div>
        <m.div
          style={{ minWidth: 0, overflow: "hidden", flex: collapsed ? "0 0 auto" : "1 1 auto" }}
          initial={false}
          animate={{
            opacity: collapsed ? 0 : 1,
            x: collapsed ? -6 : 0,
            maxWidth: collapsed ? 0 : 140,
          }}
          transition={transition}
        >
          <div style={s.userName}>{user.name}</div>
          <div style={s.userEmail}>{user.email}</div>
        </m.div>
        <m.div
          style={s.userActions}
          initial={false}
          animate={{ flexDirection: collapsed ? "column" : "row" }}
          transition={transition}
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
        </m.div>
      </m.div>
    </m.aside>
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
  brandBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    position: "relative",
    flexShrink: 0,
  },
  brandLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "inherit",
    textDecoration: "none",
    borderRadius: 8,
  },
  brandText: {
    font: "600 18px/1 var(--font-sans)",
  },
  toggleBtn: {
    position: "relative",
    width: 32,
    height: 32,
    flexShrink: 0,
    border: 0,
    padding: 0,
    borderRadius: 8,
    background: "transparent",
    color: "var(--fg-quaternary)",
    cursor: "pointer",
  },
  toggleIcon: {
    position: "absolute",
    inset: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    lineHeight: 1,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: 8,
    paddingBottom: 8,
  },
  item: {
    display: "flex",
    alignItems: "center",
    minHeight: 40,
    borderRadius: 9999,
    font: "500 14px/20px var(--font-sans)",
    color: "inherit",
  },
  iconSlot: {
    width: 20,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconGlyph: {
    fontSize: 18,
    lineHeight: 1,
    display: "block",
  },
  labelSlot: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    display: "block",
    minWidth: 0,
    transition: "margin-left 240ms cubic-bezier(0.4, 0, 0.2, 1)",
  },
  userFooter: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    marginTop: "auto",
    borderTop: "1px solid var(--border-secondary)",
    paddingTop: 12,
    paddingBottom: 12,
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
  userActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
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
