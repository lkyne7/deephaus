import { describe, expect, it } from "vitest";
import {
  buildOcclusionCardFront,
  imageUrlOnCardFront,
  occlusionOrdinals,
  parseImageOcclusionData,
} from "../image-occlusion.js";

describe("image occlusion helpers", () => {
  it("normalizes parsed occlusion data and includes only enabled ordinals", () => {
    const data = parseImageOcclusionData({
      imageUrl: "https://cdn.example.test/diagram.png",
      rects: [
        { id: "r1", x: 0.1, y: 0.2, width: 0.2, height: 0.1, ord: 3 },
        { id: "r2", x: 0.8, y: 0.2, width: 0.5, height: 0.1, ord: 2 },
        { id: "r3", x: 0.1, y: 0.4, width: 0.2, height: 0.1, ord: 1, enabled: false },
        { id: "r4", x: 0.3, y: 0.4, width: 0.2, height: 0.1, ord: 2 },
      ],
    });

    expect(data).not.toBeNull();
    expect(data?.rects[1]?.width).toBeCloseTo(0.2);
    expect(data?.rects[0]?.enabled).toBe(true);
    expect(data?.rects[2]?.enabled).toBe(false);
    expect(occlusionOrdinals(data!)).toEqual([2, 3]);
  });

  it("prefers structured occlusion data when resolving an image-occlusion front image", () => {
    const url = imageUrlOnCardFront({
      type: "image-occlusion",
      front: buildOcclusionCardFront("https://cdn.example.test/front.png", "Page 7"),
      occlusion_data: JSON.stringify({
        imageUrl: "https://cdn.example.test/occlusion.png",
        rects: [{ id: "r1", x: 0.1, y: 0.1, width: 0.2, height: 0.2, ord: 1 }],
      }),
    });

    expect(url).toBe("https://cdn.example.test/occlusion.png");
  });

  it("rejects malformed occlusion payloads instead of exposing invalid study data", () => {
    expect(parseImageOcclusionData("{not json")).toBeNull();
    expect(
      parseImageOcclusionData({
        imageUrl: "not-a-url",
        rects: [{ id: "r1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
      }),
    ).toBeNull();
  });
});
