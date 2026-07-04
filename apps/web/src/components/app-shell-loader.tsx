"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppShell, AppShellFallback } from "@/components/app-shell";
import type { SidebarUser } from "@/components/sidebar";

type Props = {
  sidebarUser: SidebarUser;
  children: ReactNode;
};

/**
 * Mount the interactive shell only after hydration. Browser tooling (e.g.
 * Cursor's embedded browser) can inject `data-cursor-ref` attributes into
 * server HTML before React hydrates, which triggers attribute mismatches on
 * sidebar/topbar buttons. Deferring the shell avoids patching against that.
 */
export function AppShellLoader({ sidebarUser, children }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <AppShellFallback>{children}</AppShellFallback>;
  }

  return <AppShell sidebarUser={sidebarUser}>{children}</AppShell>;
}
