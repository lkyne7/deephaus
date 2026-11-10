"use client";

import { AccountSection } from "@/components/settings/account-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { BillingSection } from "@/components/settings/billing-section";
import { ConnectionsSection } from "@/components/settings/connections-section";
import { useSettings } from "@/components/settings/settings-context";
import { SettingsLoadingState, useSettingsData } from "@/components/settings/settings-shell";
import { RemindersSection } from "@/components/settings/reminders-section";
import { StudySection } from "@/components/settings/study-section";
import { UniversitySection } from "@/components/settings/university-section";
import { OfflineLibrarySettings } from "@/components/offline-library";
import { RevenueCatWebProvider } from "@/lib/billing/revenuecat-web";
import type { SettingsTab } from "@/lib/settings/tabs";

export function SettingsTabContent({ tab }: { tab: SettingsTab }) {
  const { account } = useSettings();
  const { profile, setProfile, study, patchStudy, offlineAvailable } = useSettingsData();

  switch (tab) {
    case "account":
      return <AccountSection account={account} profile={profile} onProfileUpdated={setProfile} />;
    case "appearance":
      return <AppearanceSection />;
    case "study":
      return <StudySection study={study} onStudyUpdated={patchStudy} />;
    case "reminders":
      return <RemindersSection />;
    case "billing":
      return (
        <RevenueCatWebProvider appUserId={account.id}>
          <BillingSection email={account.email} />
        </RevenueCatWebProvider>
      );
    case "university":
      return <UniversitySection profile={profile} onProfileUpdated={setProfile} />;
    case "downloads":
      if (offlineAvailable === null) return <SettingsLoadingState label="Checking downloads…" />;
      return offlineAvailable ? (
        <OfflineLibrarySettings />
      ) : (
        <p className="dhs-muted">Offline downloads are not enabled on this browser.</p>
      );
    case "connections":
      return <ConnectionsSection />;
  }
}
