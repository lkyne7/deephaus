import { describe, expect, it } from "vitest";
import { parseGenerationSettings, resolveTextCardTypes } from "../schemas.js";

describe("generation settings", () => {
  it("preserves an explicit empty cardTypes array for image-occlusion-only jobs", () => {
    const settings = parseGenerationSettings({
      cardMix: "basic",
      cardTypes: [],
      autoImageOcclusion: true,
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("dedupes explicit text card types in user-selected order", () => {
    expect(
      resolveTextCardTypes({
        cardMix: "basic",
        cardTypes: ["cloze", "basic", "cloze"],
      }),
    ).toEqual(["cloze", "basic"]);
  });

  it("falls back to legacy cardMix when cardTypes is absent", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(parseGenerationSettings({ cardMix: "cloze" }).cardTypes).toEqual(["cloze"]);
  });

  it("defaults auto image occlusion off unless explicitly enabled", () => {
    expect(parseGenerationSettings({}).autoImageOcclusion).toBe(false);
  });
});
