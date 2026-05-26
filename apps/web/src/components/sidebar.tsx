"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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

export type SidebarUser = {
  name: string;
  email: string;
  initials: string;
};

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    if (href === "/decks") return pathname === "/decks" || pathname.startsWith("/decks/") && !pathname.startsWith("/decks/new");
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
    <aside style={s.root}>
      <div style={s.brand}>
        <BrandMark size={28} style={{ color: "var(--fg-primary)" }} />
        <span style={s.brandText}>DeepHaus</span>
      </div>

      <nav style={s.nav}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              style={{ ...s.item, ...(active ? s.itemActive : {}) }}
            >
              <i className={active ? item.iconActive : item.icon} style={s.itemIcon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={s.userPill}>
        <div style={s.avatar}>{user.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.userName}>{user.name}</div>
          <div style={s.userEmail}>{user.email}</div>
        </div>
        <ThemeToggle />
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          title="Sign out"
          style={s.logoutBtn}
        >
          <i className="ri-logout-box-r-line" />
        </button>
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 240,
    minHeight: "100vh",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border-secondary)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "sticky",
    top: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "22px 20px 18px",
    color: "var(--fg-primary)",
  },
  brandText: { font: "600 18px/1 var(--font-sans)" },
  nav: { display: "flex", flexDirection: "column", padding: "8px 12px", gap: 2, flex: 1 },
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
  itemIcon: { fontSize: 18, width: 20, textAlign: "center" },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    margin: "0 12px 16px",
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
  },
};
