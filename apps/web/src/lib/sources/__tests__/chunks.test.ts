import { describe, expect, it } from "vitest";
import { buildSourceChunks, parseSegmentPageRange } from "../chunks";

describe("page-aware PDF chunks", () => {
  it("preserves original page numbers from normalized extraction markers", () => {
    const chunks = buildSourceChunks(
      "pdf",
      "--- Page 4 ---\n\nFourth page content.\n\n--- Page 7 ---\n\nSeventh page content.",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sourceRef).toBe("PDF::Page4-7");
    expect(parseSegmentPageRange(chunks[0]!.sourceRef)).toEqual({
      start: 4,
      end: 7,
    });
  });
});
