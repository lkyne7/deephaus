"use client";

import { usePathname } from "next/navigation";
import { NotionIntegrationPanel } from "@/components/notion-integration-panel";
import { GoogleDriveIntegrationPanel } from "@/components/google-drive-integration-panel";
import { McpTokensPanel } from "@/components/mcp-tokens-panel";

export function ConnectionsSection() {
  const pathname = usePathname();
  // Round-trip OAuth back to this page with the connections tab re-opened.
  const returnTo = `${pathname}?settings=connections`;

  return (
    <div style={s.root}>
      <NotionIntegrationPanel returnTo={returnTo} />
      <GoogleDriveIntegrationPanel returnTo={returnTo} />
      <McpTokensPanel />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
};
