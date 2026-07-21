import {
  parseCardContent,
  rewriteCardMediaForAnki,
} from "@deephaus/shared";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_DISPLAY_WIDTH,
  MIN_IMAGE_DISPLAY_WIDTH,
  clampImageDisplayWidth,
  getCardEditorExtensions,
  getSourceDocumentExtensions,
  markdownToRichText,
  normalizeImageAspectRatio,
  richTextToHtml,
  richTextToMarkdown,
  sanitizeCardHtml,
} from "../index.js";

describe("ResizableImage", () => {
  it("clamps controlled dimensions", () => {
    expect(clampImageDisplayWidth(5)).toBe(MIN_IMAGE_DISPLAY_WIDTH);
    expect(clampImageDisplayWidth("63.456")).toBe(63.46);
    expect(clampImageDisplayWidth(500)).toBe(MAX_IMAGE_DISPLAY_WIDTH);
    expect(clampImageDisplayWidth("not-a-number")).toBe(MAX_IMAGE_DISPLAY_WIDTH);
    expect(normalizeImageAspectRatio("1.777777")).toBe(1.7778);
    expect(normalizeImageAspectRatio("100")).toBeNull();
  });

  it("is shared by card and source document extension sets", () => {
    for (const extensions of [
      getCardEditorExtensions(),
      getSourceDocumentExtensions(),
    ]) {
      const image = extensions.find((extension) => extension.name === "image");
      expect(image?.config.addNodeView).toBeTypeOf("function");
      expect(image?.config.addAttributes).toBeTypeOf("function");
    }
  });

  it("renders selection-only handles and resets on double-click", () => {
    const editor = new Editor({
      extensions: getCardEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "https://cdn.example.com/cell.png",
              displayWidth: 45,
            },
          },
        ],
      },
    });

    editor.commands.setNodeSelection(0);
    const image = editor.view.dom.querySelector<HTMLImageElement>(
      "[data-resizable-image] img",
    );
    const handles = editor.view.dom.querySelectorAll<HTMLElement>(
      "[data-resize-handle]",
    );
    expect(image).not.toBeNull();
    expect(handles).toHaveLength(2);
    expect(handles[0]?.style.display).toBe("block");

    image?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editor.getJSON().content?.[0]?.attrs?.displayWidth).toBe(100);
    editor.destroy();
  });

  it("anchors configured actions to the selected image", () => {
    const editor = new Editor({
      extensions: getSourceDocumentExtensions({
        imageActions: ["occlusion", "crop", "download"],
      }),
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://cdn.example.com/cell.png" },
          },
        ],
      },
    });
    const received: unknown[] = [];
    editor.view.dom.addEventListener("deephaus:image-action", (event) => {
      received.push((event as CustomEvent).detail);
    });

    editor.commands.setNodeSelection(0);
    const toolbar = editor.view.dom.querySelector<HTMLElement>("[data-image-actions]");
    const actions = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>("[data-image-action]"),
    );

    expect(toolbar?.style.display).toBe("inline-flex");
    expect(actions.map((action) => action.dataset.imageAction)).toEqual([
      "occlusion",
      "crop",
      "download",
    ]);
    actions[1]?.click();
    expect(received).toEqual([
      {
        action: "crop",
        src: "https://cdn.example.com/cell.png",
        pos: 0,
      },
    ]);
    editor.destroy();
  });

  it("keeps ordinary markdown images full-width markdown", () => {
    const content = markdownToRichText(
      "![cell](https://cdn.example.com/cell.png)",
    );
    const image = content.json.content?.find((node) => node.type === "image");

    expect(image?.attrs?.displayWidth).toBe(100);
    expect(image?.attrs?.aspectRatio).toBeNull();
    expect(content.markdown).toBe(
      "![cell](https://cdn.example.com/cell.png)",
    );
  });

  it("round-trips resized image metadata through markdown HTML and rich HTML", () => {
    const source =
      '<img src="https://cdn.example.com/cell.png?x=1&amp;y=2" alt="Cell &amp; membrane" data-display-width="57.5" data-aspect-ratio="1.7778">';
    const content = markdownToRichText(source);
    const image = content.json.content?.find((node) => node.type === "image");

    expect(image?.attrs).toMatchObject({
      src: "https://cdn.example.com/cell.png?x=1&y=2",
      alt: "Cell & membrane",
      displayWidth: 57.5,
      aspectRatio: 1.7778,
    });
    expect(content.markdown).toContain('data-display-width="57.5"');
    expect(content.markdown).toContain('data-aspect-ratio="1.7778"');
    expect(content.markdown).toContain("width: 57.5%");

    const reparsed = markdownToRichText(content.markdown);
    const reparsedImage = reparsed.json.content?.find(
      (node) => node.type === "image",
    );
    expect(reparsedImage?.attrs?.displayWidth).toBe(57.5);
    expect(reparsedImage?.attrs?.aspectRatio).toBe(1.7778);

    const html = richTextToHtml(content.json);
    expect(html).toContain('data-display-width="57.5"');
    expect(html).toContain('data-aspect-ratio="1.7778"');
    expect(html).toContain(
      "width: 57.5%; max-width: 100%; height: auto; aspect-ratio: 1.7778",
    );
  });

  it("serializes resized JSON as escaped, controlled HTML", () => {
    const markdown = richTextToMarkdown({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://cdn.example.com/a.png?x=1&y=2",
            alt: 'A "quoted" image',
            displayWidth: 42,
            aspectRatio: 1.5,
          },
        },
      ],
    });

    expect(markdown).toContain(
      'src="https://cdn.example.com/a.png?x=1&amp;y=2"',
    );
    expect(markdown).toContain('alt="A &quot;quoted&quot; image"');
    expect(markdown).toContain('data-display-width="42"');
    expect(markdown).toContain('data-aspect-ratio="1.5"');
  });
});

describe("resizable image sanitization and card export", () => {
  it("allows only controlled responsive image attrs and styles", () => {
    const html = sanitizeCardHtml(
      '<img src="https://cdn.example.com/a.png" data-display-width="999" data-aspect-ratio="2" style="width:999%;background:url(javascript:alert(1));height:auto" onerror="alert(1)">',
    );

    expect(html).toContain('data-display-width="100"');
    expect(html).toContain('data-aspect-ratio="2"');
    expect(html).toContain(
      'style="width: 100%; max-width: 100%; height: auto; aspect-ratio: 2"',
    );
    expect(html).not.toContain("background");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript");
  });

  it("parses HTML alt and dimensions while preserving markdown defaults", () => {
    const segments = parseCardContent(
      'Before <img alt="Kidney" data-aspect-ratio="1.25" data-display-width="48" src="https://cdn.example.com/kidney.png"> after ![Lung](https://cdn.example.com/lung.png)',
    );
    const images = segments.filter((segment) => segment.type === "image");

    expect(images).toEqual([
      {
        type: "image",
        alt: "Kidney",
        src: "https://cdn.example.com/kidney.png",
        displayWidth: 48,
        aspectRatio: 1.25,
      },
      {
        type: "image",
        alt: "Lung",
        src: "https://cdn.example.com/lung.png",
        displayWidth: 100,
      },
    ]);
  });

  it("retains controlled dimensions when rewriting images for Anki", () => {
    const rewritten = rewriteCardMediaForAnki(
      '<img src="https://cdn.example.com/kidney.png" alt="Kidney" data-display-width="48" data-aspect-ratio="1.25">',
      new Map([["https://cdn.example.com/kidney.png", "kidney.png"]]),
    );

    expect(rewritten).toContain('src="kidney.png"');
    expect(rewritten).toContain('alt="Kidney"');
    expect(rewritten).toContain('data-display-width="48"');
    expect(rewritten).toContain('data-aspect-ratio="1.25"');
    expect(rewritten).toContain(
      'style="width: 48%; max-width: 100%; height: auto; aspect-ratio: 1.25"',
    );
  });

  it("rewrites ordinary markdown images without reprocessing the result", () => {
    const rewritten = rewriteCardMediaForAnki(
      "![Kidney](https://cdn.example.com/kidney.png)",
      new Map([["https://cdn.example.com/kidney.png", "kidney.png"]]),
    );

    expect(rewritten).toBe('<img src="kidney.png" alt="Kidney">');
  });
});
