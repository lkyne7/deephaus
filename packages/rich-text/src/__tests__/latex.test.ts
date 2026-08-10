import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCardEditorExtensions,
  markdownToRichTextJson,
  richTextToHtml,
} from "../index.js";

function typeThroughInputRules(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled =
      editor.view.someProp("handleTextInput", (handler) =>
        handler(
          editor.view,
          from,
          to,
          character,
          () => editor.state.tr.insertText(character, from, to),
        ),
      ) ?? false;
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(character, from, to));
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LaTeX HTML rendering", () => {
  it("renders KaTeX markup in html output", () => {
    const json = markdownToRichTextJson("Energy $E=mc^2$ here");
    const html = richTextToHtml(json);
    expect(html).toContain("katex");
    expect(html).not.toContain("&lt;span class=\"katex");
  });

  it("renders block KaTeX", () => {
    const json = markdownToRichTextJson("$$\n\\frac{a}{b}\n$$");
    const html = richTextToHtml(json);
    expect(html).toContain("katex");
  });

  it("keeps a block equation when typing continues after it", () => {
    const editor = new Editor({
      extensions: getCardEditorExtensions(),
      content: "<p></p>",
    });

    typeThroughInputRules(editor, "$$x^2$$ after");

    const json = editor.getJSON();
    expect(json.content?.some((node) => node.type === "latexBlock")).toBe(true);
    expect(json.content?.at(-1)?.type).toBe("paragraph");
    expect(json.content?.at(-1)?.content?.[0]?.text).toBe(" after");
    editor.destroy();
  });

  it("decodes escaped operators in the server-side renderer", () => {
    vi.stubGlobal("DOMParser", undefined);
    const html = richTextToHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "latexInline",
              attrs: { formula: "x < y \\& y > 0" },
            },
          ],
        },
      ],
    });

    expect(html).toContain("katex");
    expect(html).not.toContain("katex-error");
  });
});
