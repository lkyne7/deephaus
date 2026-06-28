import { describe, expect, it } from "vitest";
import {
  mergeGenerationSettingsPatch,
  parseGenerationSettings,
  resolveTextCardTypes,
} from "../schemas.js";

describe("generation settings", () => {
  it("resolves legacy cardMix values into ordered text card types", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(resolveTextCardTypes({ cardMix: "cloze" })).toEqual(["cloze"]);
    expect(resolveTextCardTypes({ cardMix: "basic" })).toEqual(["basic"]);
    expect(resolveTextCardTypes({ cardMix: null })).toEqual(["basic"]);
  });

  it("treats cardTypes as the source of truth when present", () => {
    expect(
      resolveTextCardTypes({ cardMix: "basic", cardTypes: ["cloze", "basic", "cloze"] }),
    ).toEqual(["cloze", "basic"]);
    expect(resolveTextCardTypes({ cardMix: "both", cardTypes: [] })).toEqual([]);
  });

  it("preserves image-occlusion-only generation settings without falling back to text cards", () => {
    const settings = parseGenerationSettings({
      cardMix: "both",
      cardTypes: [],
      autoImageOcclusion: true,
      detailLevel: "high",
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
    expect(settings.detailLevel).toBe("high");
  });

  it("normalizes partial patches with defaults and resolved text card types", () => {
    const settings = mergeGenerationSettingsPatch({
      cardMix: "both",
      autoImageOcclusion: true,
    });

    expect(settings).toMatchObject({
      cardMix: "basic",
      cardTypes: ["basic", "cloze"],
      autoImageOcclusion: true,
      detailLevel: "medium",
      desiredRetention: 0.9,
      newCardsPerDay: 10,
    });
  });
});
