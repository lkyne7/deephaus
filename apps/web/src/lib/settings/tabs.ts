export const SETTINGS_TABS = [
  "account",
  "appearance",
  "study",
  "reminders",
  "billing",
  "university",
  "downloads",
  "connections",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  account: "Account",
  appearance: "Appearance",
  study: "Study",
  reminders: "Reminders",
  billing: "Usage & billing",
  university: "University",
  downloads: "Offline downloads",
  connections: "Connections",
};

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return (SETTINGS_TABS as readonly (string | null | undefined)[]).includes(value);
}

export function settingsPath(tab: SettingsTab = "account"): string {
  return `/settings/${tab}`;
}

/**
 * Old links carry the tab as `?settings=<tab>` on any page: the OAuth and
 * checkout round-trips, /profile, emails. Keep every other param so billing
 * flags, `discount_code` and the `notion`/`googleDrive` results reach the tab.
 */
export function settingsRedirectFromQuery(params: URLSearchParams): string | null {
  const tab = params.get("settings");
  if (!isSettingsTab(tab)) return null;
  const rest = new URLSearchParams(params);
  rest.delete("settings");
  const query = rest.toString();
  return query ? `${settingsPath(tab)}?${query}` : settingsPath(tab);
}
