import {
  MAX_IMAGE_DISPLAY_WIDTH,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
} from "@deephaus/shared";
import type { JSONContent } from "@tiptap/core";
import { clozeToMarkdown } from "../extensions/cloze.js";

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyMarks(text: string, marks: JSONContent["marks"] = []): string {
  let out = text;
  const has = (name: string) => marks.some((mark) => mark.type === name);

  if (has("code")) out = `\`${out}\``;
  if (has("bold")) out = `**${out}**`;
  if (has("italic")) out = `*${out}*`;
  if (has("strike")) out = `~~${out}~~`;
  if (has("underline")) out = `<u>${out}</u>`;
  if (has("superscript")) out = `<sup>${out}</sup>`;
  if (has("subscript")) out = `<sub>${out}</sub>`;
  const color = marks.find((mark) => mark.type === "textStyle")?.attrs?.color;
  if (typeof color === "string" && color) {
    out = `<span style="color:${color}">${out}</span>`;
  }
  if (has("link")) {
    const href = marks.find((mark) => mark.type === "link")?.attrs?.href ?? "";
    out = `[${out}](${href})`;
  }

  const cloze = marks.find((mark) => mark.type === "cloze");
  if (cloze) {
    out = clozeToMarkdown(out, String(cloze.attrs?.id ?? "c1"), cloze.attrs?.hint as string | null);
  }

  return out;
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "latexInline") return `$${String(node.attrs?.formula ?? "")}$`;
      return "";
    })
    .join("");
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return `${serializeInline(node.content)}\n\n`;
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const prefix = "#".repeat(Math.min(Math.max(level, 2), 3));
      return `${prefix} ${serializeInline(node.content)}\n\n`;
    }
    case "blockquote":
      return (
        node.content
          ?.map((child) =>
            serializeBlock(child)
              .trimEnd()
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n"),
          )
          .join("\n") + "\n\n"
      );
    case "codeBlock":
      return `\`\`\`\n${node.content?.map((n) => n.text ?? "").join("") ?? ""}\n\`\`\`\n\n`;
    case "bulletList":
      return (
        node.content
          ?.map((item) => `- ${serializeListItem(item)}`)
          .join("\n") + "\n\n"
      );
    case "orderedList":
      return (
        node.content
          ?.map((item, index) => `${index + 1}. ${serializeListItem(item)}`)
          .join("\n") + "\n\n"
      );
    case "latexBlock":
      return `\n$$\n${String(node.attrs?.formula ?? "")}\n$$\n\n`;
    case "image": {
      const src = String(node.attrs?.src ?? "").trim();
      if (!src) return "";
      const alt = String(node.attrs?.alt ?? "image").replace(/[[\]]/g, "") || "image";
      const displayWidth = clampImageDisplayWidth(node.attrs?.displayWidth);
      const aspectRatio = normalizeImageAspectRatio(node.attrs?.aspectRatio);
      if (displayWidth !== MAX_IMAGE_DISPLAY_WIDTH || aspectRatio != null) {
        const style = [
          `width: ${displayWidth}%`,
          "max-width: 100%",
          "height: auto",
          aspectRatio == null ? null : `aspect-ratio: ${aspectRatio}`,
        ]
          .filter(Boolean)
          .join("; ");
        return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(
          alt,
        )}" data-display-width="${displayWidth}"${
          aspectRatio == null ? "" : ` data-aspect-ratio="${aspectRatio}"`
        } style="${style}">\n\n`;
      }
      return `![${alt}](${src})\n\n`;
    }
    case "table":
      return `${serializeTable(node)}\n\n`;
    default:
      return node.content?.map(serializeBlock).join("") ?? "";
  }
}

function tableCellText(cell: JSONContent): string {
  return (cell.content ?? [])
    .map((child) =>
      child.type === "paragraph"
        ? serializeInline(child.content)
        : serializeBlock(child).trim(),
    )
    .join(" ")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}

function serializeTable(table: JSONContent): string {
  const rows = (table.content ?? []).map((row) =>
    (row.content ?? []).map(tableCellText),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ]);
  const header = normalized[0]!;
  const divider = header.map(() => "---");
  return [header, divider, ...normalized.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function serializeListItem(item: JSONContent): string {
  return item.content?.map((child) => serializeBlock(child).trim()).join(" ") ?? "";
}

export function richTextToMarkdown(json: JSONContent): string {
  const body = json.content?.map(serializeBlock).join("") ?? "";
  return body.replace(/\n{3,}/g, "\n\n").trim();
}
