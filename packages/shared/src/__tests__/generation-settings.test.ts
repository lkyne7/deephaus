import { describe, expect, it } from "vitest";
import {
  parseGenerationSettings,
  resolveTextCardTypes,
} from "../schemas.js";

describe("resolveTextCardTypes", () => {
  it("honors explicit cardTypes before legacy cardMix", () => {
    expect(
      resolveTextCardTypes({
        cardMix: "both",
        cardTypes: ["cloze", "basic", "cloze"],
      }),
    ).toEqual(["cloze", "basic"]);
  });

  it("keeps an explicit empty cardTypes array for image-occlusion-only decks", () => {
    expect(resolveTextCardTypes({ cardMix: "both", cardTypes: [] })).toEqual([]);
  });

  it("derives text card types from legacy cardMix when cardTypes is absent", () => {
    expect(resolveTextCardTypes({ cardMix: "both" })).toEqual(["basic", "cloze"]);
    expect(resolveTextCardTypes({ cardMix: "cloze" })).toEqual(["cloze"]);
    expect(resolveTextCardTypes({})).toEqual(["basic"]);
  });
});

describe("parseGenerationSettings", () => {
  it("normalizes auto-image-occlusion-only settings without re-adding text cards", () => {
    expect(
      parseGenerationSettings({
        cardMix: "both",
        cardTypes: [],
        autoImageOcclusion: true,
        detailLevel: "high",
      }),
    ).toMatchObject({
      cardMix: "basic",
      cardTypes: [],
      autoImageOcclusion: true,
      detailLevel: "high",
    });
  });

  it("defaults auto image occlusion off for legacy settings", () => {
    expect(parseGenerationSettings({ cardMix: "cloze" })).toMatchObject({
      cardMix: "cloze",
      cardTypes: ["cloze"],
      autoImageOcclusion: false,
    });
  });
});
