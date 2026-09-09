import { describe, expect, it } from "vitest";
import {
  buildCardRichTextContent,
  markdownToRichText,
  markdownToRichTextJson,
  richTextToHtml,
  richTextToHtmlWithClozeMode,
  richTextToMarkdown,
  richTextToPlainText,
  richTextToPlainTextWithClozeMode,
} from "../index.js";

describe("rich-text conversions", () => {
  it("round-trips cloze markdown", () => {
    const source = "The {{c1::mitochondria}} is the {{c2::powerhouse::organelle}} of the cell.";
    const json = markdownToRichTextJson(source);
    const md = richTextToMarkdown(json);
    expect(md).toContain("{{c1::mitochondria}}");
    expect(md).toContain("{{c2::powerhouse::organelle}}");
  });

  it("preserves inline and block LaTeX in markdown export", () => {
    const source = "Inline $E=mc^2$ and block:\n\n$$\n\\int_0^1 x\\,dx\n$$";
    const content = markdownToRichText(source);
    expect(content.markdown).toContain("$E=mc^2$");
    expect(content.markdown).toContain("$$");
    expect(content.plainText).toContain("$E=mc^2$");
  });

  it("extracts plain text without markup", () => {
    const content = markdownToRichText("**Bold** and *italic*");
    expect(richTextToPlainText(content.json)).toContain("Bold");
    expect(richTextToPlainText(content.json)).toContain("italic");
  });

  it("hides cloze text in plain text hidden mode", () => {
    const json = markdownToRichTextJson("Answer: {{c1::ATP}}");
    expect(richTextToPlainTextWithClozeMode(json, "hidden")).toContain("[...]");
    expect(richTextToPlainTextWithClozeMode(json, "hidden")).not.toContain("ATP");
    expect(richTextToPlainTextWithClozeMode(json, "revealed")).toContain("ATP");
  });

  it("hides only the active cloze ordinal in study plain text mode", () => {
    const json = markdownToRichTextJson("The {{c1::mitochondria}} and {{c2::nucleus}}");
    const hiddenC1 = richTextToPlainTextWithClozeMode(json, "hidden", 1);
    expect(hiddenC1).toContain("[...]");
    expect(hiddenC1).toContain("nucleus");
    expect(hiddenC1).not.toContain("mitochondria");

    const hiddenC2 = richTextToPlainTextWithClozeMode(json, "hidden", 2);
    expect(hiddenC2).toContain("mitochondria");
    expect(hiddenC2).not.toContain("nucleus");
  });

  it("keeps cloze colors in hidden html mode with bracket blanks", () => {
    const json = markdownToRichTextJson("The {{c1::mitochondria}} and {{c2::nucleus}}");
    const html = richTextToHtmlWithClozeMode(json, "hidden");
    expect(html).toContain("dh-cloze--c1");
    expect(html).toContain("dh-cloze--c2");
    expect(html).toContain("[...]");
    expect(html).not.toContain("mitochondria");
    expect(html).not.toContain("nucleus");
  });

  it("hides only the active cloze ordinal in study html mode", () => {
    const json = markdownToRichTextJson("The {{c1::mitochondria}} and {{c2::nucleus}}");
    const html = richTextToHtmlWithClozeMode(json, "hidden", 1);
    expect(html).toContain("[...]");
    expect(html).toContain("nucleus");
    expect(html).not.toContain("mitochondria");
    expect(html).toContain("dh-cloze--c1");
    expect(html).not.toContain("dh-cloze--c2");
  });

  it("shows cloze hints as placeholders in study hidden mode", () => {
    const json = markdownToRichTextJson("The {{c2::powerhouse::organelle}} of the cell.");

    const plain = richTextToPlainTextWithClozeMode(json, "hidden", 2);
    expect(plain).toContain("[organelle]");
    expect(plain).not.toContain("[...]");
    expect(plain).not.toContain("powerhouse");

    const html = richTextToHtmlWithClozeMode(json, "hidden", 2);
    expect(html).toContain("[organelle]");
    expect(html).not.toContain("powerhouse");
    expect(html).toContain("dh-cloze--c2");
  });

  it("reveals only the active cloze highlight in study answer mode", () => {
    const json = markdownToRichTextJson("The {{c1::mitochondria}} and {{c2::nucleus}}");
    const html = richTextToHtmlWithClozeMode(json, "revealed", 2);
    expect(html).toContain("nucleus");
    expect(html).toContain("mitochondria");
    expect(html).toContain("dh-cloze--c2");
    expect(html).not.toContain("dh-cloze--c1");
  });

  describe("inline styling inside a cloze (AnKing cue letters)", () => {
    const source =
      'Remembered with "{{c1::SPPARTAS}}":\n{{c1::<u>**S**</u>epsis}}\n{{c1::<u>**P**</u>ancreatitis}}, {{c1::<u>**P**</u>neumonia::lung}}';

    it("parses bold/underline inside the deletion", () => {
      const html = richTextToHtml(markdownToRichTextJson(source));
      // The cloze span stays outermost so the styled word is one highlight box.
      expect(html).toMatch(
        /<span data-cloze-id="c1"[^>]*><(strong|u)><(strong|u)>S<\/\2><\/\1>epsis<\/span>/,
      );
      expect(html).not.toContain("**");
      expect(html).not.toContain("&lt;u&gt;");
      // Exactly one cloze span per item (4 in total).
      expect(html.match(/data-cloze-id="c1"/g)?.length).toBe(4);
    });

    it("round-trips as a single cloze per item", () => {
      const md = richTextToMarkdown(markdownToRichTextJson(source));
      expect(md).toContain("{{c1::<u>**S**</u>epsis}}");
      expect(md).toContain("{{c1::<u>**P**</u>ancreatitis}}, {{c1::<u>**P**</u>neumonia::lung}}");
      // Never fragments a styled deletion into `{{c1::**S**}}{{c1::epsis}}`.
      expect(md.match(/\{\{c1::/g)?.length).toBe(4);
    });

    it("hides a styled deletion as one blank", () => {
      const json = markdownToRichTextJson(source);
      const html = richTextToHtmlWithClozeMode(json, "hidden", 1);
      expect(html).not.toContain("epsis");
      expect(html).not.toContain("<strong>");
      expect(html.match(/\[\.\.\.\]/g)?.length).toBe(3);
      expect(html.match(/\[lung\]/g)?.length).toBe(1);

      const plain = richTextToPlainTextWithClozeMode(json, "hidden", 1);
      expect(plain.match(/\[\.\.\.\]/g)?.length).toBe(3);
      expect(plain).toContain("[...], [lung]");
    });

    it("keeps plain clozes untouched", () => {
      const json = markdownToRichTextJson("The {{c1::mitochondria}} is {{c2::small}}.");
      expect(richTextToMarkdown(json)).toBe("The {{c1::mitochondria}} is {{c2::small}}.");
      expect(richTextToHtmlWithClozeMode(json, "hidden").match(/\[\.\.\.\]/g)?.length).toBe(2);
    });
  });

  it("produces sanitized html", () => {
    const content = buildCardRichTextContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "safe" }],
        },
      ],
    });
    expect(richTextToHtml(content.json)).toContain("safe");
    expect(richTextToHtml(content.json)).not.toContain("<script");
  });

  it("round-trips markdown images through the card schema", () => {
    const source = "See diagram:\n\n![cell](https://cdn.example.com/cell.png)";
    const content = markdownToRichText(source);
    expect(content.markdown).toContain("![cell](https://cdn.example.com/cell.png)");
    expect(JSON.stringify(content.json)).toContain("cdn.example.com/cell.png");
    expect(content.html).toContain("<img");
    expect(content.html).toContain("https://cdn.example.com/cell.png");
  });
});
