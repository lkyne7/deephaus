import { describe, expect, it } from "vitest";
import {
  mergeGenerationSettingsPatch,
  parseGenerationSettings,
  resolveTextCardTypes,
} from "../schemas.js";

describe("generation settings", () => {
  it("uses explicit cardTypes ahead of legacy cardMix and dedupes in order", () => {
    expect(resolveTextCardTypes({ cardMix: "basic", cardTypes: ["cloze", "basic", "cloze"] })).toEqual([
      "cloze",
      "basic",
    ]);
  });

  it("preserves an explicit empty cardTypes array for image-occlusion-only generation", () => {
    const settings = parseGenerationSettings({
      cardMix: "both",
      cardTypes: [],
      autoImageOcclusion: true,
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("falls back from legacy cardMix when cardTypes are absent", () => {
    expect(parseGenerationSettings({ cardMix: "both" }).cardTypes).toEqual(["basic", "cloze"]);
    expect(parseGenerationSettings({ cardMix: "cloze" }).cardTypes).toEqual(["cloze"]);
    expect(parseGenerationSettings({}).cardTypes).toEqual(["basic"]);
  });

  it("applies generation patch defaults without enabling auto image occlusion implicitly", () => {
    const settings = mergeGenerationSettingsPatch({
      detailLevel: "high",
      newCardsPerDay: 0,
    });

    expect(settings).toMatchObject({
      cardMix: "basic",
      cardTypes: ["basic"],
      autoImageOcclusion: false,
      detailLevel: "high",
      desiredRetention: 0.9,
      newCardsPerDay: 0,
    });
  });
});
