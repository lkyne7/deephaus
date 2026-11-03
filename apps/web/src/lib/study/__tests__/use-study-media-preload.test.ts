import { describe, expect, it } from "vitest";
import { studyCardImageSources } from "../use-study-media-preload";

const media = "https://example.supabase.co/storage/v1/object/public/card-media/u/a.png";
const occlusion = "https://example.supabase.co/storage/v1/object/public/card-media/u/io.png";

describe("studyCardImageSources", () => {
  it("collects images from every rendered field once, plus the occlusion image", () => {
    const sources = studyCardImageSources({
      front: `Question ![](${media})`,
      back: `Answer ![](${media})`,
      extra: null,
      occlusion_data: { imageUrl: occlusion, rects: [] },
    });
    expect(sources).toContain(media);
    expect(sources).toContain(occlusion);
    expect(sources.filter((src) => src === media)).toHaveLength(1);
  });

  it("returns nothing for text-only cards", () => {
    expect(studyCardImageSources({ front: "Plain", back: "Text" })).toEqual([]);
  });
});
