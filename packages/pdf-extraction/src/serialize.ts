import type { ExtractedBlock, ExtractedDocument } from "./types.js";

export type ProseMirrorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: ProseMirrorNode[];
};

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function inlineContent(value: string): ProseMirrorNode[] {
  const text = value
    .replace(/^#{1,6}\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  const nodes: ProseMirrorNode[] = [];
  const regex =
    /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|\$[^$\n]+\$|\[[^\]\n]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ type: "text", text: text.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("$")) {
      nodes.push({
        type: "latexInline",
        attrs: { formula: token.slice(1, -1).trim() },
      });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const mark = token.startsWith("**")
        ? "bold"
        : token.startsWith("~~")
          ? "strike"
          : token.startsWith("`")
            ? "code"
            : token.startsWith("*")
              ? "italic"
              : "link";
      const trim = mark === "bold" || mark === "strike" ? 2 : 1;
      nodes.push({
        type: "text",
        text: link ? link[1]! : token.slice(trim, -trim),
        marks: [
          mark === "link"
            ? { type: "link", attrs: { href: link?.[2] ?? "" } }
            : { type: mark },
        ],
      });
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) });
  return nodes.filter((node) => node.type !== "text" || Boolean(node.text));
}

function paragraph(value = ""): ProseMirrorNode {
  const content = inlineContent(value);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function blockInlineContent(block: ExtractedBlock): ProseMirrorNode[] {
  if (!block.runs?.length) {
    return inlineContent(block.text ?? block.markdown ?? "");
  }
  return block.runs
    .filter((run) => run.text)
    .map((run) => {
      const marks = [
        ...(run.bold ? [{ type: "bold" }] : []),
        ...(run.italic ? [{ type: "italic" }] : []),
      ];
      return {
        type: "text",
        text: run.text,
        ...(marks.length ? { marks } : {}),
      };
    });
}

function tableNode(html: string): ProseMirrorNode | null {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!rows.length) return null;
  const content = rows.reduce<ProseMirrorNode[]>((result, row) => {
      const cells = [...row[1]!.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      if (!cells.length) return result;
      result.push({
        type: "tableRow",
        content: cells.map((cell) => ({
          type: cell[1]!.toLowerCase() === "th" ? "tableHeader" : "tableCell",
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [paragraph(decodeHtml(cell[2]!))],
        })),
      });
      return result;
    }, []);
  return content.length ? { type: "table", content } : null;
}

function blockNodes(block: ExtractedBlock): ProseMirrorNode[] {
  switch (block.kind) {
    case "heading":
      return [
        {
          type: "heading",
          attrs: { level: block.level ?? 2 },
          content: blockInlineContent(block),
        },
      ];
    case "list":
      return [
        {
          type: "bulletList",
          content: (block.items ?? block.text?.split("\n") ?? []).map((item) => ({
            type: "listItem",
            content: [paragraph(item)],
          })),
        },
      ];
    case "equation":
      return [{ type: "latexBlock", attrs: { formula: block.latex ?? "" } }];
    case "table": {
      const table = tableNode(block.html ?? block.markdown ?? "");
      return table ? [table] : [paragraph(decodeHtml(block.html ?? block.markdown ?? ""))];
    }
    case "image":
      if (!block.image?.storageUrl) return [];
      return [
        {
          type: "image",
          attrs: {
            src: block.image.storageUrl,
            alt: block.image.alt ?? "Extracted figure",
            title: block.image.alt ?? null,
          },
        },
      ];
    case "caption":
      return [
        {
          type: "paragraph",
          attrs: { class: "source-figure-caption" },
          content: blockInlineContent(block),
        },
      ];
    case "code":
      return [
        {
          type: "codeBlock",
          content: [{ type: "text", text: block.text ?? block.markdown ?? "" }],
        },
      ];
    default:
      return [
        {
          type: "paragraph",
          ...(blockInlineContent(block).length
            ? { content: blockInlineContent(block) }
            : {}),
        },
      ];
  }
}

export function documentToProseMirror(document: ExtractedDocument): ProseMirrorNode {
  const content: ProseMirrorNode[] = [];
  for (const page of document.pages) {
    content.push({
      type: "heading",
      attrs: { level: 2, sourcePage: page.pageNumber },
      content: [{ type: "text", text: `Page ${page.pageNumber}` }],
    });
    for (const block of page.blocks) content.push(...blockNodes(block));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function documentToMarkdown(document: ExtractedDocument): string {
  return document.pages
    .map(
      (page) =>
        `## Page ${page.pageNumber}\n\n${page.markdown || page.blocks
          .map((block) => block.markdown ?? block.text ?? "")
          .filter(Boolean)
          .join("\n\n")}`,
    )
    .join("\n\n");
}

export function documentToPlainText(document: ExtractedDocument): string {
  return document.pages
    .map((page) => {
      const text = page.blocks
        .map((block) => {
          if (block.kind === "equation") return `$$${block.latex ?? ""}$$`;
          if (block.kind === "table") return decodeHtml(block.html ?? block.markdown ?? "");
          if (block.kind === "image") return block.image?.alt ?? "";
          if (block.kind === "list") return (block.items ?? []).join("\n");
          return block.text ?? block.markdown ?? "";
        })
        .filter(Boolean)
        .join("\n\n");
      return `--- Page ${page.pageNumber} ---\n\n${text}`;
    })
    .join("\n\n")
    .trim();
}
