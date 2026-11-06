"use client";

import { NotionIntegrationPanel } from "@/components/notion-integration-panel";
import { GoogleDriveIntegrationPanel } from "@/components/google-drive-integration-panel";
import { McpTokensPanel } from "@/components/mcp-tokens-panel";
import { settingsPath } from "@/lib/settings/tabs";

const RETURN_TO = settingsPath("connections");

export function ConnectionsSection() {
  return (
    <>
      <section className="dhs-sec">
        <h2>Sources</h2>
        <NotionIntegrationPanel returnTo={RETURN_TO} />
        <GoogleDriveIntegrationPanel returnTo={RETURN_TO} />
      </section>
      <McpTokensPanel />
    </>
  );
}
