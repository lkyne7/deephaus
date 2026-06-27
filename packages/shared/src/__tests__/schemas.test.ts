import { describe, expect, it } from "vitest";
import { parseGenerationSettings, resolveTextCardTypes } from "../schemas.js";

describe("generation settings parsing", () => {
  it("defaults to basic text generation without automatic image occlusion", () => {
    const settings = parseGenerationSettings({});

    expect(settings).toMatchObject({
      cardMix: "basic",
      cardTypes: ["basic"],
      autoImageOcclusion: false,
      detailLevel: "medium",
      desiredRetention: 0.9,
      newCardsPerDay: 10,
    });
  });

  it("maps legacy cardMix both to both text card types", () => {
    const settings = parseGenerationSettings({
      cardMix: "both",
      autoImageOcclusion: true,
    });

    expect(settings.cardMix).toBe("basic");
    expect(settings.cardTypes).toEqual(["basic", "cloze"]);
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("treats an explicit empty cardTypes array as image-occlusion only", () => {
    const settings = parseGenerationSettings({
      cardMix: "both",
      cardTypes: [],
      autoImageOcclusion: true,
    });

    expect(settings.cardMix).toBe("basic");
    expect(settings.cardTypes).toEqual([]);
    expect(settings.autoImageOcclusion).toBe(true);
  });

  it("dedupes explicit cardTypes while preserving the requested primary type", () => {
    const settings = parseGenerationSettings({
      cardMix: "basic",
      cardTypes: ["cloze", "basic", "cloze"],
    });

    expect(settings.cardMix).toBe("cloze");
    expect(settings.cardTypes).toEqual(["cloze", "basic"]);
  });

  it("derives detail level from legacy density when no detailLevel is stored", () => {
    expect(parseGenerationSettings({ density: 3 }).detailLevel).toBe("low");
    expect(parseGenerationSettings({ density: 7 }).detailLevel).toBe("medium");
    expect(parseGenerationSettings({ density: 8 }).detailLevel).toBe("high");
  });

  it("lets explicit detailLevel take precedence over legacy density", () => {
    const settings = parseGenerationSettings({
      detailLevel: "low",
      density: 20,
    });

    expect(settings.detailLevel).toBe("low");
  });
});

describe("text card type resolution", () => {
  it("uses explicit cardTypes even when empty", () => {
    expect(resolveTextCardTypes({ cardMix: "both", cardTypes: [] })).toEqual([]);
  });

  it("falls back to legacy cardMix when cardTypes is absent", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(resolveTextCardTypes({ cardMix: "cloze" })).toEqual(["cloze"]);
    expect(resolveTextCardTypes({})).toEqual(["basic"]);
  });
});
