import { describe, expect, it } from "vitest";
import { parseGenerationSettings, resolveTextCardTypes } from "../schemas.js";

describe("generation settings", () => {
  it("preserves an explicit empty text-card selection for image-occlusion-only generation", () => {
    const settings = parseGenerationSettings({
      cardTypes: [],
      autoImageOcclusion: true,
      detailLevel: "high",
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
    expect(settings.detailLevel).toBe("high");
  });

  it("uses explicit cardTypes before legacy cardMix and removes duplicates", () => {
    expect(
      resolveTextCardTypes({
        cardMix: "both",
        cardTypes: ["cloze", "basic", "cloze"],
      }),
    ).toEqual(["cloze", "basic"]);
  });

  it("falls back to legacy cardMix when cardTypes are not stored", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(parseGenerationSettings({ cardMix: "cloze" }).cardTypes).toEqual(["cloze"]);
  });

  it("defaults auto image occlusion off for legacy settings", () => {
    expect(parseGenerationSettings({ cardMix: "basic" }).autoImageOcclusion).toBe(false);
  });
});
