import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));

const { DEFAULT_CREATE_OPTIONS, generationSettings, parseCreateOptions } = await import(
  "../lib/create-options"
);

describe("parseCreateOptions", () => {
  it("defaults quality to medium for options saved before quality existed", () => {
    const saved = JSON.stringify({ detailLevel: "high", cardType: "cloze", autoTags: false });
    expect(parseCreateOptions(saved)).toMatchObject({
      detailLevel: "high",
      cardType: "cloze",
      autoTags: false,
      qualityLevel: "medium",
    });
  });

  it("keeps a saved quality level and drops an unknown one", () => {
    expect(parseCreateOptions(JSON.stringify({ qualityLevel: "high" })).qualityLevel).toBe("high");
    expect(parseCreateOptions(JSON.stringify({ qualityLevel: "ultra" })).qualityLevel).toBe("medium");
  });

  it("falls back to defaults on unreadable storage", () => {
    expect(parseCreateOptions("{not json")).toEqual(DEFAULT_CREATE_OPTIONS);
    expect(parseCreateOptions(null)).toEqual(DEFAULT_CREATE_OPTIONS);
  });
});

describe("generationSettings", () => {
  it("sends the quality level with every run", () => {
    expect(generationSettings({ ...DEFAULT_CREATE_OPTIONS, qualityLevel: "low" })).toMatchObject({
      detailLevel: "medium",
      qualityLevel: "low",
    });
  });
});
