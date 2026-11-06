import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsTabContent } from "@/components/settings/settings-tab-content";
import { SETTINGS_TAB_LABELS, isSettingsTab, settingsPath } from "@/lib/settings/tabs";

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  return { title: isSettingsTab(tab) ? `${SETTINGS_TAB_LABELS[tab]} · Settings` : "Settings" };
}

export default async function SettingsTabPage({ params }: Props) {
  const { tab } = await params;
  if (!isSettingsTab(tab)) redirect(settingsPath());
  return <SettingsTabContent tab={tab} />;
}
