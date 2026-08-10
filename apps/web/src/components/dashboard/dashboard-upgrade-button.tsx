"use client";

import { useSettings } from "@/components/settings/settings-context";

export function DashboardUpgradeButton() {
  const { openSettings } = useSettings();

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => openSettings("billing")}
      aria-label="Upgrade to Plus or Pro"
    >
      <i className="ri-vip-crown-line" aria-hidden />
      Upgrade
    </button>
  );
}
