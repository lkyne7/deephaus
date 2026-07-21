import { describe, expect, it } from "vitest";
import {
  documentToMarkdown,
  documentToPlainText,
  documentToProseMirror,
} from "../serialize.js";
import { shouldSeedExtractedContent } from "../seed.js";
import type { ExtractedDocument } from "../types.js";

const document: ExtractedDocument = {
  version: "test",
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      width: 612,
      height: 792,
      provider: "mistral-ocr",
      qualityScore: 0.96,
      markdown: "",
      blocks: [
        { id: "h", kind: "heading", order: 0, level: 1, text: "Results" },
        { id: "p", kind: "paragraph", order: 1, text: "Value $x^2$ is **measured**." },
        { id: "e", kind: "equation", order: 2, latex: "E=mc^2" },
        {
          id: "t",
          kind: "table",
          order: 3,
          html: "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
        },
        {
          id: "i",
          kind: "image",
          order: 4,
          image: {
            id: "figure",
            mime: "image/png",
            storageUrl: "https://example.com/figure.png",
            alt: "Measured curve",
          },
        },
        { id: "c", kind: "caption", order: 5, text: "Figure 1. Measured curve." },
      ],
    },
  ],
};

describe("editable extraction output", () => {
  it("preserves page anchors and rich editable nodes", () => {
    const output = documentToProseMirror(document);
    expect(output.content?.[0]).toMatchObject({
      type: "heading",
      content: [{ text: "Page 1" }],
    });
    expect(output.content?.some((node) => node.type === "latexBlock")).toBe(true);
    expect(
      output.content
        ?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "latexInline" && node.attrs?.formula === "x^2"),
    ).toBe(true);
    expect(output.content?.some((node) => node.type === "table")).toBe(true);
    expect(output.content?.some((node) => node.type === "image")).toBe(true);
    expect(output.content?.at(-1)?.content?.[0]?.text).toContain("Figure 1");
    expect(
      output.content
        ?.flatMap((node) => node.content ?? [])
        .some((node) => node.marks?.some((mark) => mark.type === "bold")),
    ).toBe(true);
  });

  it("emits page-aware Markdown and plain text", () => {
    expect(documentToMarkdown(document)).toContain("## Page 1");
    const plain = documentToPlainText(document);
    expect(plain).toContain("--- Page 1 ---");
    expect(plain).toContain("E=mc^2");
    expect(plain).toContain("Measured curve");
  });

  it("never overwrites a user-edited source document", () => {
    expect(shouldSeedExtractedContent(null)).toBe(true);
    expect(shouldSeedExtractedContent(undefined)).toBe(true);
    expect(shouldSeedExtractedContent("2026-07-19T12:00:00.000Z")).toBe(false);
  });
});
