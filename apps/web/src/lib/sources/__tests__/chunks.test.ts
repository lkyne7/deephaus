import { describe, expect, it } from "vitest";
import { buildSourceChunks, buildGenerationChunks, isPdfNavigationPage, parseSegmentPageRange } from "../chunks";

describe("page-aware PDF chunks", () => {
  it("omits bibliography and index pages while preserving original chapter page numbers", () => {
    const references = "References 633\n" + "Author, A. (2020). A cited work.\n".repeat(4);
    const index = "738 Index\n" + Array.from({ length: 12 }, (_, i) => `Term ${i} ${i + 1}`).join("\n");
    const raw = `--- Page 20 ---\nPsychology studies mind and behavior.\n--- Page 645 ---\n${references}\n--- Page 750 ---\n${index}`;
    const persisted = buildSourceChunks("pdf", raw);
    const chunks = buildGenerationChunks("pdf", raw);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(persisted[0]?.index);
    expect(chunks[0]?.sourceRef).toBe(persisted[0]?.sourceRef);
    expect(chunks[0]?.text).toContain("--- Page 20 ---");
    expect(chunks[0]?.text).not.toContain("--- Page 750 ---");
    expect(chunks[0]?.text).not.toContain("cited work");
  });
  it("keeps glossary definitions and substantive discussions of references", () => {
    expect(isPdfNavigationPage("Key Terms\n**axon** major extension of the soma")).toBe(false);
    expect(isPdfNavigationPage("References\nReferences help readers evaluate evidence and locate sources.")).toBe(false);
    expect(isPdfNavigationPage("The ISBN identifies a book, while copyright protects expression.")).toBe(false);
  });
  it("recognizes a continuation of the table of contents", () => {
    expect(isPdfNavigationPage("CHAPTER 12\nKey Terms 435\nReview Questions 440\nCHAPTER 13\nKey Terms 477\nReview Questions 480")).toBe(true);
  });
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
