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

const notionBlocksDocument = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Done thing" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Open thing" }] }],
        },
      ],
    },
    {
      type: "callout",
      attrs: { emoji: "⚠️" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Watch out" }] }],
    },
    {
      type: "toggle",
      attrs: { open: false },
      content: [
        { type: "toggleSummary", content: [{ type: "text", text: "Hidden section" }] },
        {
          type: "toggleContent",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Inside the toggle" }] }],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "python" },
      content: [{ type: "text", text: "print('hi')" }],
    },
  ],
};

describe("notion-style blocks", () => {
  it("flattens tasks, callouts, toggles, and code to plain text", () => {
    expect(sourceDocToPlainText(notionBlocksDocument)).toBe(
      [
        "- [x] Done thing\n- [ ] Open thing",
        "Watch out",
        "Hidden section",
        "Inside the toggle",
        "print('hi')",
      ].join("\n\n"),
    );
  });

  it("serializes tasks, callouts, toggles, and code to Markdown", () => {
    expect(richTextToMarkdown(notionBlocksDocument)).toBe(
      [
        "- [x] Done thing\n- [ ] Open thing",
        "> ⚠️ Watch out",
        "**Hidden section**",
        "Inside the toggle",
        "```python\nprint('hi')\n```",
      ].join("\n\n"),
    );
  });
});
