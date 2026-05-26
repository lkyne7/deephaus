import type { JSONContent } from "@tiptap/core";
import { clozeToMarkdown } from "../extensions/cloze.js";

function applyMarks(text: string, marks: JSONContent["marks"] = []): string {
  let out = text;
  const has = (name: string) => marks.some((mark) => mark.type === name);

  if (has("code")) out = `\`${out}\``;
  if (has("bold")) out = `**${out}**`;
  if (has("italic")) out = `*${out}*`;
  if (has("underline")) out = `<u>${out}</u>`;
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
    default:
      return node.content?.map(serializeBlock).join("") ?? "";
  }
}

function serializeListItem(item: JSONContent): string {
  return item.content?.map((child) => serializeBlock(child).trim()).join(" ") ?? "";
}

export function richTextToMarkdown(json: JSONContent): string {
  const body = json.content?.map(serializeBlock).join("") ?? "";
  return body.replace(/\n{3,}/g, "\n\n").trim();
}
