import { describe, expect, it } from "vitest";
import { parseGenerationSettings, resolveTextCardTypes } from "../index.js";

describe("generation settings", () => {
  it("keeps image-occlusion-only generation from falling back to basic cards", () => {
    const settings = parseGenerationSettings({
      cardMix: "basic",
      cardTypes: [],
      autoImageOcclusion: true,
    });

    expect(settings.cardTypes).toEqual([]);
    expect(settings.cardMix).toBe("basic");
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("derives text card types from legacy cardMix when cardTypes is omitted", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(resolveTextCardTypes({ cardMix: "cloze" })).toEqual(["cloze"]);
    expect(resolveTextCardTypes({ cardMix: "basic" })).toEqual(["basic"]);
  });

  it("dedupes explicit text card types while preserving intentional order", () => {
    const settings = parseGenerationSettings({
      cardMix: "basic",
      cardTypes: ["cloze", "basic", "cloze"],
    });

    expect(settings.cardTypes).toEqual(["cloze", "basic"]);
    expect(settings.cardMix).toBe("cloze");
  });
});
