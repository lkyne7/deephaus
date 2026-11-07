import { describe, expect, it } from "vitest";
import {
  imageUrlOnCardFront,
  normalizeOcclusionRect,
  occlusionCardPreviewText,
  occlusionOrdinals,
  parseImageOcclusionData,
  type ImageOcclusionData,
  type OcclusionRect,
} from "../image-occlusion.js";

function rect(overrides: Partial<OcclusionRect> = {}): OcclusionRect {
  return {
    id: "rect-1",
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    ...overrides,
  };
}

describe("image occlusion helpers", () => {
  it("normalizes occlusion rects into study-safe bounds and defaults", () => {
    const normalized = normalizeOcclusionRect(
      rect({
        x: 0.9,
        y: 0.99,
        width: 0.5,
        height: 0,
        enabled: undefined,
        ord: 42,
      }),
    );

    expect(normalized.x).toBe(0.9);
    expect(normalized.y).toBe(0.99);
    expect(normalized.width).toBeCloseTo(0.1);
    expect(normalized.height).toBe(0.01);
    expect(normalized.enabled).toBe(true);
    expect(normalized.ord).toBe(9);
  });

  it("parses persisted occlusion data and rejects invalid payloads", () => {
    const parsed = parseImageOcclusionData(
      JSON.stringify({
        imageUrl: "https://example.com/diagram.png",
        rects: [rect({ enabled: false, ord: 2 })],
      }),
    );

    expect(parsed).toEqual({
      imageUrl: "https://example.com/diagram.png",
      rects: [
        {
          id: "rect-1",
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
          enabled: false,
          ord: 2,
        },
      ],
    });
    expect(parseImageOcclusionData("{not json")).toBeNull();
    expect(parseImageOcclusionData({ imageUrl: "notaurl", rects: [rect()] })).toBeNull();
  });

  it("returns sorted unique ordinals for enabled regions only", () => {
    const data: ImageOcclusionData = {
      imageUrl: "https://example.com/diagram.png",
      rects: [
        rect({ id: "disabled", enabled: false, ord: 1 }),
        rect({ id: "third", ord: 3 }),
        rect({ id: "default-ord" }),
        rect({ id: "third-duplicate", ord: 3 }),
        rect({ id: "last", ord: 9 }),
      ],
    };

    expect(occlusionOrdinals(data)).toEqual([1, 3, 9]);
  });

  it("uses occlusion data as the source image for image-occlusion cards", () => {
    expect(
      imageUrlOnCardFront({
        type: "image-occlusion",
        front: "stale front ![old](https://example.com/old.png)",
        occlusion_data: {
          imageUrl: "https://example.com/current.png",
          rects: [rect()],
        },
      }),
    ).toBe("https://example.com/current.png");

    expect(
      imageUrlOnCardFront({
        type: "basic",
        front: "front ![diagram](https://example.com/basic.png)",
      }),
    ).toBe("https://example.com/basic.png");
  });

  it("builds image-occlusion preview labels without leaking image markdown", () => {
    expect(
      occlusionCardPreviewText(
        "Cranial nerves\n\n![diagram](https://example.com/diagram.png)",
        null,
      ),
    ).toBe("Cranial nerves");

    expect(occlusionCardPreviewText("![diagram](https://example.com/diagram.png)", "Fallback")).toBe(
      "Fallback",
    );
    expect(occlusionCardPreviewText(null, null)).toBe("[Image occlusion]");
  });
});
