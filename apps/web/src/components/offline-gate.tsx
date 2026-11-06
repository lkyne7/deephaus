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
    <div role="status" className="dh-note">
      <i className="ri-cloud-off-line" aria-hidden />
      <span>
        {feature} needs an internet connection. You&apos;re offline, but studying and editing your
        decks still works.
      </span>
    </div>
  );
}
