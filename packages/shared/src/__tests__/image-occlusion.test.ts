import { describe, expect, it } from "vitest";
import {
  buildOcclusionCardFront,
  normalizeOcclusionRect,
  occlusionOrdinals,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "../index.js";

describe("image occlusion helpers", () => {
  it("normalizes persisted occlusion rects before study queue ordinals are read", () => {
    const parsed = parseImageOcclusionData({
      imageUrl: "https://example.com/diagram.png",
      rects: [
        { id: "a", x: 0.95, y: 0.9, width: 0.2, height: 0.3, ord: 12 },
        { id: "b", x: 0.1, y: 0.2, width: 0.3, height: 0.4, enabled: false, ord: 2 },
        { id: "c", x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rects[0]).toMatchObject({
      x: 0.95,
      y: 0.9,
      width: 0.05,
      height: 0.1,
      enabled: true,
      ord: 9,
    });
    expect(parsed?.rects[1]).toMatchObject({ enabled: false, ord: 2 });
    expect(parsed?.rects[2]).toMatchObject({ enabled: true, ord: 1 });
    expect(parsed ? occlusionOrdinals(parsed) : []).toEqual([1, 9]);
  });

  it("parses JSON string data and rejects malformed occlusion payloads", () => {
    const raw = JSON.stringify({
      imageUrl: "https://example.com/slide.webp",
      rects: [{ id: "label", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    });

    expect(parseImageOcclusionData(raw)?.imageUrl).toBe("https://example.com/slide.webp");
    expect(parseImageOcclusionData("{not json")).toBeNull();
    expect(parseImageOcclusionData({ imageUrl: "not a url", rects: [] })).toBeNull();
  });

  it("builds card fronts with an optional source header above the image", () => {
    expect(buildOcclusionCardFront("https://example.com/card.png", " Page 4 ")).toBe(
      "Page 4\n\n![image](https://example.com/card.png)",
    );
    expect(buildOcclusionCardFront("https://example.com/card.png")).toBe(
      "![image](https://example.com/card.png)",
    );
  });

  it("clamps user-edited regions into valid bounds", () => {
    const rect: ImageOcclusionData["rects"][number] = {
      id: "edge",
      x: -0.2,
      y: 1.2,
      width: 0.005,
      height: 0.005,
      ord: 0,
    };

    expect(normalizeOcclusionRect(rect)).toMatchObject({
      x: 0,
      y: 1,
      width: 0.01,
      height: 0.01,
      enabled: true,
      ord: 1,
    });
  });
});
