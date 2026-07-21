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

describe("website and spreadsheet chunks", () => {
  it("labels website sections with Website provenance", () => {
    const chunks = buildSourceChunks("website", "Readable website content ".repeat(40));
    expect(chunks[0]?.sourceRef).toMatch(/^Website::Chunk/);
  });

  it("keeps spreadsheet sheet names and globally unique indices", () => {
    const chunks = buildSourceChunks(
      "xlsx",
      `--- Sheet: Anatomy ---\n${"cell value ".repeat(800)}
       --- Sheet: Doses ---\n${"dose value ".repeat(800)}`,
    );
    expect(chunks.some((chunk) => chunk.sourceRef.startsWith("Sheet Anatomy::"))).toBe(true);
    expect(chunks.some((chunk) => chunk.sourceRef.startsWith("Sheet Doses::"))).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.index)).size).toBe(chunks.length);
  });
});
