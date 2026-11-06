import { describe, expect, it } from "vitest";
import {
  SETTINGS_TABS,
  isSettingsTab,
  settingsPath,
  settingsRedirectFromQuery,
} from "@/lib/settings/tabs";

const redirect = (query: string) => settingsRedirectFromQuery(new URLSearchParams(query));

describe("settings tabs", () => {
  it("recognises only the known slugs", () => {
    for (const tab of SETTINGS_TABS) expect(isSettingsTab(tab)).toBe(true);
    expect(isSettingsTab("usage")).toBe(false);
    expect(isSettingsTab("")).toBe(false);
    expect(isSettingsTab(null)).toBe(false);
    expect(isSettingsTab(undefined)).toBe(false);
  });

  it("builds tab paths, defaulting to account", () => {
    expect(settingsPath()).toBe("/settings/account");
    expect(settingsPath("billing")).toBe("/settings/billing");
  });
});

describe("settingsRedirectFromQuery", () => {
  it("redirects each tab to its route", () => {
    for (const tab of SETTINGS_TABS) {
      expect(redirect(`settings=${tab}`)).toBe(`/settings/${tab}`);
    }
  });

  it("keeps discount codes and checkout flags for the billing tab", () => {
    expect(redirect("settings=billing&discount_code=SPRING")).toBe(
      "/settings/billing?discount_code=SPRING",
    );
    expect(redirect("billing=success&settings=billing")).toBe("/settings/billing?billing=success");
  });

  it("keeps OAuth results for the connections tab", () => {
    expect(redirect("settings=connections&notion=error&message=Declined+access")).toBe(
      "/settings/connections?notion=error&message=Declined+access",
    );
  });

  it("ignores missing and unknown tabs", () => {
    expect(redirect("")).toBeNull();
    expect(redirect("q=settings")).toBeNull();
    expect(redirect("settings=profile")).toBeNull();
  });
});
