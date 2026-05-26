import { describe, expect, it } from "vitest";
import { markdownToRichTextJson, richTextToHtml } from "../index.js";

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
});
