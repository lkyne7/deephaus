import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { getCardEditorExtensions } from "../extensions/index.js";
import { richTextToMarkdown } from "../serialize/markdown.js";

function createEditor(content?: object) {
  return new Editor({
    extensions: getCardEditorExtensions({ clozeEnabled: true }),
    content: content ?? {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    },
  });
}

function countClozeMarks(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type.name === "cloze")) count += 1;
  });
  return count;
}

describe("cloze marks", () => {
  it("round-trips hints in markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ATP",
              marks: [{ type: "cloze", attrs: { id: "c1", hint: "energy currency" } }],
            },
          ],
        },
      ],
    };
    const md = richTextToMarkdown(json);
    expect(md).toContain("{{c1::ATP::energy currency}}");
  });

  it("does not nest cloze marks when applying over an existing cloze", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "mitochondria",
              marks: [{ type: "cloze", attrs: { id: "c1", hint: null } }],
            },
          ],
        },
      ],
    });

    editor.commands.selectAll();
    editor.commands.addClozeNew();

    const textNode = editor.state.doc.firstChild?.firstChild;
    expect(textNode?.isText).toBe(true);
    const clozeMarks = textNode?.marks.filter((m) => m.type.name === "cloze") ?? [];
    expect(clozeMarks).toHaveLength(1);
    expect(clozeMarks[0]?.attrs.id).toBe("c2");

    editor.destroy();
  });

  it("merges overlapping clozes into a single deletion", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "one",
              marks: [{ type: "cloze", attrs: { id: "c1", hint: null } }],
            },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "two",
              marks: [{ type: "cloze", attrs: { id: "c2", hint: null } }],
            },
          ],
        },
      ],
    });

    editor.commands.selectAll();
    editor.commands.addClozeNew();

    expect(countClozeMarks(editor)).toBeGreaterThan(0);
    const md = richTextToMarkdown(editor.getJSON());
    expect(md.match(/\{\{c\d+::/g)?.length).toBe(1);

    editor.destroy();
  });

  it("updates hint via updateCloze", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "nucleus",
              marks: [{ type: "cloze", attrs: { id: "c1", hint: null } }],
            },
          ],
        },
      ],
    });

    editor.commands.selectAll();
    editor.commands.updateCloze({ hint: "control center" });

    const md = richTextToMarkdown(editor.getJSON());
    expect(md).toContain("{{c1::nucleus::control center}}");

    editor.destroy();
  });
});
