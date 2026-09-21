import { expect, it } from "vitest";
import type { NetworkState } from "expo-network";
import { shouldPauseMediaDownloads } from "../lib/media-download-policy";

const wifi = { type: "WIFI", isConnected: true, isInternetReachable: true } as NetworkState;
const policy = { paused: false, cellular: false };
it.each(["background", "inactive"] as const)("keeps downloads paused during %s even on Wi-Fi", (state) => {
  expect(shouldPauseMediaDownloads(state, policy, wifi)).toBe(true);
});
it("resumes only when active and permitted by the saved network policy", () => {
  expect(shouldPauseMediaDownloads("active", policy, wifi)).toBe(false);
  expect(shouldPauseMediaDownloads("active", { ...policy, paused: true }, wifi)).toBe(true);
  const cellular = { ...wifi, type: "CELLULAR" } as NetworkState;
  expect(shouldPauseMediaDownloads("active", policy, cellular)).toBe(true);
  expect(shouldPauseMediaDownloads("active", { ...policy, cellular: true }, cellular)).toBe(false);
  expect(shouldPauseMediaDownloads("active", policy, { ...wifi, isInternetReachable: false })).toBe(true);
});
