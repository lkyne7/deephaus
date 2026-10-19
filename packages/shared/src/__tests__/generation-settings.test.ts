import { describe, expect, it } from "vitest";

import { parseGenerationSettings, resolveTextCardTypes } from "../schemas.js";

describe("resolveTextCardTypes", () => {
  it("preserves an explicit empty cardTypes array for occlusion-only decks", () => {
    expect(resolveTextCardTypes({ cardMix: "both", cardTypes: [] })).toEqual([]);
  });

  it("uses explicit cardTypes over legacy cardMix and preserves first-seen order", () => {
    expect(
      resolveTextCardTypes({
        cardMix: "basic",
        cardTypes: ["cloze", "basic", "cloze"],
      }),
    ).toEqual(["cloze", "basic"]);
  });

  it("expands legacy cardMix settings when cardTypes is absent", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(resolveTextCardTypes({ cardMix: "cloze" })).toEqual(["cloze"]);
    expect(resolveTextCardTypes({})).toEqual(["basic"]);
  });
});

describe("parseGenerationSettings", () => {
  it("keeps occlusion-only settings from re-enabling text generation", () => {
    const settings = parseGenerationSettings({
      cardMix: "both",
      cardTypes: [],
      autoImageOcclusion: true,
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("defaults auto image occlusion to disabled for legacy project settings", () => {
    const settings = parseGenerationSettings({ cardMix: "both" });

    expect(settings.cardTypes).toEqual(["basic", "cloze"]);
    expect(settings.autoImageOcclusion).toBe(false);
  });
});
