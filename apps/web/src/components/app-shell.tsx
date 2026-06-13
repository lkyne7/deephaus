"use client";

import type { ReactNode } from "react";
import { AnimatedMain } from "@/components/motion/animated-main";
import { AppChrome } from "@/components/page-header-context";
import { Sidebar, type SidebarUser } from "@/components/sidebar";

type Props = {
  sidebarUser: SidebarUser;
  children: ReactNode;
};

/** App chrome (sidebar + top bar). Client-only mount avoids hydration mismatches from browser tooling. */
export function AppShell({ sidebarUser, children }: Props) {
  return (
    <div style={shell.root}>
      <Sidebar user={sidebarUser} />
      <div style={shell.main}>
        <AppChrome />
        <AnimatedMain>{children}</AnimatedMain>
      </div>
    </div>
  );
}

/** Placeholder while AppShell loads — matches expanded sidebar width to limit layout shift. */
export function AppShellFallback() {
  return (
    <div style={shell.root}>
      <aside
        style={shell.sidebarPlaceholder}
        className="notion-sidebar"
        aria-hidden
      />
      <div style={shell.main} />
    </div>
  );
}

const shell: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "var(--bg-canvas)",
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    zIndex: 0,
  },
  sidebarPlaceholder: {
    width: 260,
    flexShrink: 0,
    height: "100vh",
    alignSelf: "flex-start",
    position: "sticky",
    top: 0,
    borderRight: "1px solid var(--border-2)",
    background: "var(--bg-canvas)",
  },
};
