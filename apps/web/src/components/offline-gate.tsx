"use client";

import type { ReactNode } from "react";
import { useOnline } from "@/lib/offline/use-online";

/**
 * Gate for online-only features (AI generation, billing, community,
 * integrations, leaderboard). Renders children when online; otherwise shows a
 * compact notice explaining the feature needs a connection.
 */
export function OfflineGate({
  feature,
  children,
}: {
  /** Short feature label, e.g. "AI generation" or "Community decks". */
  feature: string;
  children: ReactNode;
}) {
  const online = useOnline();
  if (online) return <>{children}</>;
  return <OfflineNotice feature={feature} />;
}

export function OfflineNotice({ feature }: { feature: string }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid var(--color-border-secondary, rgba(128,128,128,0.25))",
        background: "var(--color-bg-secondary, rgba(128,128,128,0.06))",
        fontSize: 14,
      }}
    >
      <i className="ri-cloud-off-line" aria-hidden style={{ fontSize: 16, opacity: 0.7 }} />
      <span>
        {feature} needs an internet connection. You&apos;re offline — studying and
        editing your decks still works.
      </span>
    </div>
  );
}
