"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
        <span style={s.brandMark}>
          <i className="ri-stack-fill" />
        </span>
        <span style={s.brandText}>Sluggo</span>
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
    background: "var(--white)",
    borderRight: "1px solid var(--border-1)",
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
    color: "var(--ink-900)",
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: "var(--ink-900)",
    color: "var(--white)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
  },
  brandText: { font: "600 18px/1 var(--font-sans)" },
  nav: { display: "flex", flexDirection: "column", padding: "8px 12px", gap: 2, flex: 1 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "transparent",
    color: "var(--ink-500)",
    borderRadius: 9999,
    font: "500 14px/20px var(--font-sans)",
    textDecoration: "none",
  },
  itemActive: { background: "var(--ink-25)", color: "var(--ink-900)" },
  itemIcon: { fontSize: 18, width: 20, textAlign: "center" },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    margin: "0 12px 16px",
    borderTop: "1px solid var(--border-1)",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--teal-500)",
    color: "var(--white)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "500 12px/1 var(--font-sans)",
    flexShrink: 0,
  },
  userName: {
    font: "500 13px/16px var(--font-sans)",
    color: "var(--ink-900)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  userEmail: {
    font: "400 11px/14px var(--font-sans)",
    color: "var(--fg-4)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  logoutBtn: {
    background: "transparent",
    border: 0,
    padding: 6,
    borderRadius: 6,
    color: "var(--fg-4)",
    fontSize: 16,
  },
};
