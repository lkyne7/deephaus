import { describe, expect, it } from "vitest";
import {
  buildOcclusionCardFront,
  normalizeOcclusionRect,
  occlusionOrdinals,
  parseImageOcclusionData,
} from "../image-occlusion.js";

const imageUrl = "https://example.com/diagram.png";

describe("image occlusion helpers", () => {
  it("normalizes parsed rect geometry and ordinals", () => {
    const parsed = parseImageOcclusionData({
      imageUrl,
      rects: [
        {
          id: "heart-label",
          x: 0.96,
          y: 0,
          width: 0.2,
          height: 1,
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rects[0]).toMatchObject({
      id: "heart-label",
      x: 0.96,
      y: 0,
      width: 0.04,
      height: 1,
      enabled: true,
      ord: 1,
    });
  });

  it("clamps rect ordinals and minimum geometry during direct normalization", () => {
    expect(
      normalizeOcclusionRect({
        id: "oversized",
        x: 0.5,
        y: 0.5,
        width: 0,
        height: 0,
        ord: 14,
      }),
    ).toMatchObject({
      width: 0.01,
      height: 0.01,
      enabled: true,
      ord: 9,
    });
  });

  it("accepts serialized data and rejects malformed image URLs", () => {
    expect(
      parseImageOcclusionData(
        JSON.stringify({
          imageUrl,
          rects: [{ id: "r1", x: 0, y: 0, width: 0.2, height: 0.2 }],
        }),
      ),
    ).not.toBeNull();

    expect(
      parseImageOcclusionData({
        imageUrl: "/relative/diagram.png",
        rects: [{ id: "r1", x: 0, y: 0, width: 0.2, height: 0.2 }],
      }),
    ).toBeNull();
  });

  it("returns sorted unique ordinals from enabled occlusion regions", () => {
    const data = {
      imageUrl,
      rects: [
        normalizeOcclusionRect({
          id: "disabled",
          x: 0,
          y: 0,
          width: 0.2,
          height: 0.2,
          ord: 1,
          enabled: false,
        }),
        normalizeOcclusionRect({
          id: "third",
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          ord: 3,
        }),
        normalizeOcclusionRect({
          id: "second-a",
          x: 0.2,
          y: 0.2,
          width: 0.2,
          height: 0.2,
          ord: 2,
        }),
        normalizeOcclusionRect({
          id: "second-b",
          x: 0.3,
          y: 0.3,
          width: 0.2,
          height: 0.2,
          ord: 2,
        }),
      ],
    };

    expect(occlusionOrdinals(data)).toEqual([2, 3]);
  });

  it("builds a front field with trimmed source context before the image", () => {
    expect(buildOcclusionCardFront(imageUrl, "  Page 4  ")).toBe(
      `Page 4\n\n\n\n![image](${imageUrl})`,
    );
  });
});
