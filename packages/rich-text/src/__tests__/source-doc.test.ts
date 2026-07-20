import { describe, expect, it } from "vitest";
import { richTextToMarkdown } from "../serialize/markdown.js";
import { sourceDocToPlainText } from "../serialize/source-doc.js";

const tableDocument = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
          ],
        },
      ],
    },
  ],
};

describe("editable source tables", () => {
  it("preserves table shape in Markdown", () => {
    expect(richTextToMarkdown(tableDocument)).toBe(
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("keeps table cells available to generation", () => {
    expect(sourceDocToPlainText(tableDocument)).toBe("A\tB\n1\t2");
  });
});
