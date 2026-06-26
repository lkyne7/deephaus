import { describe, expect, it } from "vitest";
import {
  buildOcclusionCardFront,
  normalizeOcclusionRect,
  occlusionOrdinals,
  parseImageOcclusionData,
} from "../image-occlusion.js";

describe("image occlusion data", () => {
  it("normalizes parsed rects before deriving queue ordinals", () => {
    const data = parseImageOcclusionData({
      imageUrl: "https://example.com/diagram.png",
      rects: [
        { id: "a", x: 0.9, y: 0.95, width: 0.5, height: 0.2, ord: 9 },
        { id: "b", x: 0.1, y: 0.2, width: 0.3, height: 0.2, ord: 2, enabled: false },
        { id: "c", x: 0.4, y: 0.2, width: 0.2, height: 0.2, ord: 2 },
      ],
    });

    expect(data).not.toBeNull();
    expect(data?.rects[0]).toMatchObject({
      x: 0.9,
      y: 0.95,
      width: 0.1,
      height: 0.05,
      enabled: true,
      ord: 9,
    });
    expect(occlusionOrdinals(data!)).toEqual([2, 9]);
  });

  it("returns null for malformed or invalid occlusion payloads", () => {
    expect(parseImageOcclusionData("{not-json")).toBeNull();
    expect(
      parseImageOcclusionData({
        imageUrl: "not-a-url",
        rects: [{ id: "a", x: 0, y: 0, width: 0.2, height: 0.2 }],
      }),
    ).toBeNull();
  });

  it("clamps rect dimensions to stay visible after normalization", () => {
    expect(
      normalizeOcclusionRect({
        id: "tiny",
        x: 1,
        y: 1,
        width: 0,
        height: 0,
        ord: 0,
      }),
    ).toMatchObject({
      x: 1,
      y: 1,
      width: 0.01,
      height: 0.01,
      enabled: true,
      ord: 1,
    });
  });

  it("builds front content with an optional source header", () => {
    expect(buildOcclusionCardFront("https://example.com/diagram.png", "Page 4")).toBe(
      "Page 4\n\n![image](https://example.com/diagram.png)",
    );
    expect(buildOcclusionCardFront("https://example.com/diagram.png")).toBe(
      "![image](https://example.com/diagram.png)",
    );
  });
});
