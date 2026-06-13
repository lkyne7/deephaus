"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { SidebarUser } from "@/components/sidebar";

type Props = {
  sidebarUser: SidebarUser;
  children: ReactNode;
};

export function AppShellLoader({ sidebarUser, children }: Props) {
  return <AppShell sidebarUser={sidebarUser}>{children}</AppShell>;
}
