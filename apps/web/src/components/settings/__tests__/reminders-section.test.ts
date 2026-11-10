import { describe, expect, it } from "vitest";
import {
  minutesToTimeValue,
  testSentNotice,
  testWasDelivered,
  thisDeviceCopy,
  timeValueToMinutes,
} from "@/components/settings/reminders-section";

describe("reminder time fields", () => {
  it("converts minutes after midnight to a time input value and back", () => {
    expect(minutesToTimeValue(0)).toBe("00:00");
    expect(minutesToTimeValue(19 * 60)).toBe("19:00");
    expect(minutesToTimeValue(8 * 60 + 5)).toBe("08:05");
    expect(minutesToTimeValue(5000)).toBe("23:59");
    expect(timeValueToMinutes("19:00")).toBe(1140);
    expect(timeValueToMinutes("08:05")).toBe(485);
    expect(timeValueToMinutes("7:30")).toBe(450);
  });

  it("rejects what is not a time of day", () => {
    for (const bad of ["", "24:00", "12:60", "noon", "12:5"]) {
      expect(timeValueToMinutes(bad), bad).toBeNull();
    }
  });
});

describe("thisDeviceCopy", () => {
  it("offers the one action that makes sense", () => {
    expect(thisDeviceCopy("on").action).toBe("Turn off");
    expect(thisDeviceCopy("off").action).toBe("Turn on");
    // Nothing the app can do from here: the browser or its settings decide.
    expect(thisDeviceCopy("blocked").action).toBeNull();
    expect(thisDeviceCopy("unsupported").action).toBeNull();
    expect(thisDeviceCopy(null).action).toBeNull();
    expect(thisDeviceCopy("blocked").status).toContain("site settings");
  });
});

describe("testWasDelivered", () => {
  it("is true only when some device took the reminder", () => {
    expect(testWasDelivered([{ result: "sent" }])).toBe(true);
    // The open desktop app collects a queued reminder itself.
    expect(testWasDelivered([{ result: "gone" }, { result: "queued" }])).toBe(true);
    expect(testWasDelivered([{ result: "gone" }])).toBe(false);
    expect(testWasDelivered([{ result: "failed" }, { result: "unsupported" }])).toBe(false);
    expect(testWasDelivered([])).toBe(false);
    expect(testWasDelivered(undefined)).toBe(false);
  });
});

describe("testSentNotice", () => {
  const usual = "Test reminder sent. It should appear within a few seconds.";

  it("warns that the first reminder can go missing when a browser was only just turned on", () => {
    const notice = testSentNotice([{ platform: "web", result: "sent" }], 5_000);
    expect(notice).toContain("wait half a minute and send another");
    expect(testSentNotice([{ platform: "web", result: "sent" }], 119_000)).toBe(notice);
  });

  it("says the usual thing once the browser has been on for two minutes, or was on already", () => {
    expect(testSentNotice([{ platform: "web", result: "sent" }], 120_000)).toBe(usual);
    expect(testSentNotice([{ platform: "web", result: "sent" }], null)).toBe(usual);
  });

  it("does not warn when nothing was pushed to a browser", () => {
    // The open desktop app collects its reminder itself, at once.
    expect(testSentNotice([{ platform: "desktop", result: "queued" }], 5_000)).toBe(usual);
    expect(testSentNotice([{ platform: "web", result: "gone" }, { platform: "desktop", result: "queued" }], 5_000)).toBe(usual);
    expect(testSentNotice(undefined, 5_000)).toBe(usual);
  });
});
