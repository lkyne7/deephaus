"use client";

import type { ReactNode } from "react";
import { AnimatedMain } from "@/components/motion/animated-main";
import { Sidebar, type SidebarUser } from "@/components/sidebar";

type Props = {
  sidebarUser: SidebarUser;
  children: ReactNode;
};

/** App chrome (sidebar). Client-only mount avoids hydration mismatches from browser tooling. */
export function AppShell({ sidebarUser, children }: Props) {
  return (
    <div style={shell.root}>
      <Sidebar user={sidebarUser} />
      <main style={shell.main} className="dh-app-main">
        <AnimatedMain>{children}</AnimatedMain>
      </main>
    </div>
  );
}

/** Placeholder while AppShell loads — matches expanded sidebar width to limit layout shift. */
export function AppShellFallback({ children }: { children?: ReactNode }) {
  return (
    <div style={shell.root}>
      <aside
        style={shell.sidebarPlaceholder}
        className="notion-sidebar"
        aria-hidden
      />
      <main style={shell.main} className="dh-app-main">{children}</main>
    </div>
  );
}

const shell: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100dvh",
    overflow: "hidden",
    background: "var(--bg-canvas)",
  },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    zIndex: 0,
    overflow: "auto",
  },
  sidebarPlaceholder: {
    width: 260,
    flexShrink: 0,
    height: "100dvh",
    alignSelf: "flex-start",
    position: "sticky",
    top: 0,
    borderRight: "1px solid var(--border-2)",
    background: "var(--bg-canvas)",
  },
};
