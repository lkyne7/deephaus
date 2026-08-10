import "server-only";
import type { JSONContent } from "@tiptap/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extensionForMime, uploadSourceMedia } from "@/lib/sources/source-media";
import { notionJson } from "./client";
import { getNotionPage, type NotionPageSummary } from "./pages";

/**
 * Fetch a Notion page's block tree and convert it into the TipTap document
 * shape used by the source-document editor (same node set as html-to-doc.ts:
 * headings 1-3, paragraphs, lists, blockquotes, code, images, latex, rules).
 */

const MAX_BLOCKS = 2000;
const MAX_DEPTH = 6;

type NotionRichText = {
  type?: string;
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
  equation?: { expression?: string };
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type BlockChildrenResponse = {
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
};

export type NotionImportResult = {
  doc: JSONContent;
  page: NotionPageSummary;
  blockCount: number;
};

type ImportContext = {
  userId: string;
  supabase: SupabaseClient;
  sourceId: string;
  uploadImages: boolean;
  blockCount: number;
  imageIndex: number;
};

export async function importNotionPageDoc(opts: {
  userId: string;
  pageId: string;
  supabase: SupabaseClient;
  sourceId: string;
  /** Skip storage uploads (previews) — Notion-hosted images are dropped. */
  uploadImages?: boolean;
}): Promise<NotionImportResult> {
  const page = await getNotionPage(opts.userId, opts.pageId);
  const ctx: ImportContext = {
    userId: opts.userId,
    supabase: opts.supabase,
    sourceId: opts.sourceId,
    uploadImages: opts.uploadImages ?? true,
    blockCount: 0,
    imageIndex: 0,
  };
  const blocks = await fetchBlockTree(ctx, opts.pageId, 0);
  const content = await blocksToContent(ctx, blocks);
  return {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    page,
    blockCount: ctx.blockCount,
  };
}

/** Recursively fetch children (paginated) up to block/depth caps. */
async function fetchBlockTree(
  ctx: ImportContext,
  blockId: string,
  depth: number,
): Promise<NotionBlock[]> {
  if (depth >= MAX_DEPTH || ctx.blockCount >= MAX_BLOCKS) return [];

  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const data: BlockChildrenResponse = await notionJson<BlockChildrenResponse>(
      ctx.userId,
      `/blocks/${blockId}/children?${params.toString()}`,
      { method: "GET" },
    );
    for (const block of data.results ?? []) {
      if (ctx.blockCount >= MAX_BLOCKS) break;
      ctx.blockCount += 1;
      if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
        (block as NotionBlock & { __children?: NotionBlock[] }).__children = await fetchBlockTree(
          ctx,
          block.id,
          depth + 1,
        );
      }
      blocks.push(block);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && ctx.blockCount < MAX_BLOCKS);

  return blocks;
}

function childrenOf(block: NotionBlock): NotionBlock[] {
  return (block as NotionBlock & { __children?: NotionBlock[] }).__children ?? [];
}

function richTextOf(block: NotionBlock): NotionRichText[] {
  const payload = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
  return payload?.rich_text ?? [];
}

/** Convert Notion rich text runs into ProseMirror inline nodes with marks. */
function inlineFromRichText(richText: NotionRichText[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of richText) {
    if (run.type === "equation" || run.equation) {
      const formula = run.equation?.expression ?? run.plain_text ?? "";
      if (formula) out.push({ type: "latexInline", attrs: { formula } });
      continue;
    }
    const text = run.plain_text ?? "";
    if (!text) continue;
    const marks: NonNullable<JSONContent["marks"]> = [];
    const a = run.annotations ?? {};
    if (a.bold) marks.push({ type: "bold" });
    if (a.italic) marks.push({ type: "italic" });
    if (a.underline) marks.push({ type: "underline" });
    if (a.strikethrough) marks.push({ type: "strike" });
    if (a.code) marks.push({ type: "code" });
    if (run.href) marks.push({ type: "link", attrs: { href: run.href } });
    out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
  }
  return out;
}

function paragraphFrom(inline: JSONContent[]): JSONContent {
  return inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" };
}

function plainTextOf(richText: NotionRichText[]): string {
  return richText.map((run) => run.plain_text ?? "").join("");
}

async function blocksToContent(
  ctx: ImportContext,
  blocks: NotionBlock[],
): Promise<JSONContent[]> {
  const out: JSONContent[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index]!;
    const listType = listTypeFor(block.type);
    if (listType) {
      // Group consecutive same-type list blocks into one list node.
      const items: JSONContent[] = [];
      while (index < blocks.length && listTypeFor(blocks[index]!.type) === listType) {
        items.push(await listItemFrom(ctx, blocks[index]!));
        index += 1;
      }
      out.push({ type: listType, content: items });
      continue;
    }

    out.push(...(await blockToNodes(ctx, block)));
    index += 1;
  }

  return out;
}

function listTypeFor(blockType: string): "bulletList" | "orderedList" | "taskList" | null {
  if (blockType === "bulleted_list_item") return "bulletList";
  if (blockType === "to_do") return "taskList";
  if (blockType === "numbered_list_item") return "orderedList";
  return null;
}

async function listItemFrom(ctx: ImportContext, block: NotionBlock): Promise<JSONContent> {
  const inline = inlineFromRichText(richTextOf(block));
  const content: JSONContent[] = [paragraphFrom(inline)];
  const children = childrenOf(block);
  if (children.length) {
    content.push(...(await blocksToContent(ctx, children)));
  }
  if (block.type === "to_do") {
    const payload = block.to_do as { checked?: boolean } | undefined;
    return {
      type: "taskItem",
      attrs: { checked: Boolean(payload?.checked) },
      content,
    };
  }
  return { type: "listItem", content };
}

async function blockToNodes(ctx: ImportContext, block: NotionBlock): Promise<JSONContent[]> {
  switch (block.type) {
    case "paragraph": {
      const inline = inlineFromRichText(richTextOf(block));
      const nodes: JSONContent[] = inline.length ? [paragraphFrom(inline)] : [];
      return [...nodes, ...(await blocksToContent(ctx, childrenOf(block)))];
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(block.type.slice(-1));
      const inline = inlineFromRichText(richTextOf(block));
      const nodes: JSONContent[] = inline.length
        ? [{ type: "heading", attrs: { level }, content: inline }]
        : [];
      // Toggleable headings can nest content.
      return [...nodes, ...(await blocksToContent(ctx, childrenOf(block)))];
    }
    case "quote": {
      const inner: JSONContent[] = [];
      const inline = inlineFromRichText(richTextOf(block));
      if (inline.length) inner.push(paragraphFrom(inline));
      inner.push(...(await blocksToContent(ctx, childrenOf(block))));
      return [{ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] }];
    }
    case "callout": {
      const payload = block.callout as { icon?: { type?: string; emoji?: string } } | undefined;
      const emoji =
        payload?.icon?.type === "emoji" && payload.icon.emoji ? payload.icon.emoji : "💡";
      const inner: JSONContent[] = [];
      const inline = inlineFromRichText(richTextOf(block));
      if (inline.length) inner.push(paragraphFrom(inline));
      inner.push(...(await blocksToContent(ctx, childrenOf(block))));
      return [
        {
          type: "callout",
          attrs: { emoji },
          content: inner.length ? inner : [{ type: "paragraph" }],
        },
      ];
    }
    case "toggle": {
      const inline = inlineFromRichText(richTextOf(block));
      const body = await blocksToContent(ctx, childrenOf(block));
      return [
        {
          type: "toggle",
          attrs: { open: false },
          content: [
            { type: "toggleSummary", ...(inline.length ? { content: inline } : {}) },
            {
              type: "toggleContent",
              content: body.length ? body : [{ type: "paragraph" }],
            },
          ],
        },
      ];
    }
    case "code": {
      const payload = block.code as { language?: string } | undefined;
      const text = plainTextOf(richTextOf(block));
      if (!text) return [];
      return [
        {
          type: "codeBlock",
          attrs: { language: payload?.language ?? null },
          content: [{ type: "text", text }],
        },
      ];
    }
    case "equation": {
      const payload = block.equation as { expression?: string } | undefined;
      const formula = payload?.expression ?? "";
      return formula ? [{ type: "latexBlock", attrs: { formula } }] : [];
    }
    case "divider":
      return [{ type: "horizontalRule" }];
    case "image": {
      const node = await importImage(ctx, block);
      return node ? [node] : [];
    }
    case "bookmark":
    case "embed":
    case "link_preview":
    case "video":
    case "file":
    case "pdf": {
      const payload = block[block.type] as
        | { url?: string; external?: { url?: string }; file?: { url?: string }; caption?: NotionRichText[] }
        | undefined;
      const url = payload?.url ?? payload?.external?.url ?? payload?.file?.url ?? null;
      if (!url) return [];
      const caption = plainTextOf(payload?.caption ?? []).trim();
      const label = caption || url;
      return [
        {
          type: "paragraph",
          content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href: url } }] }],
        },
      ];
    }
    case "child_page": {
      const payload = block.child_page as { title?: string } | undefined;
      const title = payload?.title?.trim();
      if (!title) return [];
      return [
        { type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "bold" }] }] },
      ];
    }
    case "table": {
      const tablePayload = block.table as { has_column_header?: boolean } | undefined;
      const hasHeader = Boolean(tablePayload?.has_column_header);
      const rows: JSONContent[] = [];
      let rowIndex = 0;
      for (const row of childrenOf(block)) {
        if (row.type !== "table_row") continue;
        const payload = row.table_row as { cells?: NotionRichText[][] } | undefined;
        const cellType = hasHeader && rowIndex === 0 ? "tableHeader" : "tableCell";
        const cells = (payload?.cells ?? []).map((cell) => ({
          type: cellType,
          content: [paragraphFrom(inlineFromRichText(cell))],
        }));
        if (cells.length) {
          rows.push({ type: "tableRow", content: cells });
          rowIndex += 1;
        }
      }
      return rows.length ? [{ type: "table", content: rows }] : [];
    }
    case "column_list":
    case "column":
    case "synced_block":
    case "table_of_contents":
    case "breadcrumb":
      return blocksToContent(ctx, childrenOf(block));
    default: {
      // Unknown/unsupported block: keep its text if it has any.
      const inline = inlineFromRichText(richTextOf(block));
      const nodes: JSONContent[] = inline.length ? [paragraphFrom(inline)] : [];
      return [...nodes, ...(await blocksToContent(ctx, childrenOf(block)))];
    }
  }
}

/**
 * Notion-hosted file URLs expire after ~1 hour, so images are downloaded and
 * re-uploaded to our public media bucket. External image URLs are kept as-is.
 */
async function importImage(ctx: ImportContext, block: NotionBlock): Promise<JSONContent | null> {
  const payload = block.image as
    | {
        type?: string;
        external?: { url?: string };
        file?: { url?: string };
        caption?: NotionRichText[];
      }
    | undefined;
  if (!payload) return null;
  const alt = plainTextOf(payload.caption ?? []).trim();

  if (payload.type === "external" && payload.external?.url) {
    return { type: "image", attrs: { src: payload.external.url, alt, title: alt || null } };
  }

  const fileUrl = payload.file?.url;
  if (!fileUrl || !ctx.uploadImages) return null;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    if (!mime.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) return null;
    ctx.imageIndex += 1;
    const name = `notion-${ctx.imageIndex}.${extensionForMime(mime)}`;
    const url = await uploadSourceMedia(ctx.supabase, ctx.userId, ctx.sourceId, name, bytes, mime);
    if (!url) return null;
    return { type: "image", attrs: { src: url, alt, title: alt || null } };
  } catch (err) {
    console.warn("[notion] image import failed:", err);
    return null;
  }
}
