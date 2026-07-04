import "server-only";
import { notionJson } from "./client";

export type NotionPageSummary = {
  id: string;
  title: string;
  /** Emoji character or image URL, when the page has an icon. */
  icon: string | null;
  iconType: "emoji" | "url" | null;
  url: string | null;
  lastEdited: string | null;
};

type NotionRichTextItem = { plain_text?: string };

type NotionPageObject = {
  object: string;
  id: string;
  url?: string;
  last_edited_time?: string;
  icon?:
    | { type: "emoji"; emoji: string }
    | { type: "external"; external: { url: string } }
    | { type: "file"; file: { url: string } }
    | null;
  properties?: Record<string, { type?: string; title?: NotionRichTextItem[] }>;
};

type NotionSearchResponse = {
  results: NotionPageObject[];
  next_cursor: string | null;
  has_more: boolean;
};

export function notionPageTitle(page: NotionPageObject): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? "").join("").trim();
      if (text) return text;
    }
  }
  return "Untitled";
}

function notionPageIcon(page: NotionPageObject): Pick<NotionPageSummary, "icon" | "iconType"> {
  const icon = page.icon;
  if (!icon) return { icon: null, iconType: null };
  if (icon.type === "emoji") return { icon: icon.emoji, iconType: "emoji" };
  if (icon.type === "external") return { icon: icon.external.url, iconType: "url" };
  if (icon.type === "file") return { icon: icon.file.url, iconType: "url" };
  return { icon: null, iconType: null };
}

export function toPageSummary(page: NotionPageObject): NotionPageSummary {
  return {
    id: page.id,
    title: notionPageTitle(page),
    ...notionPageIcon(page),
    url: page.url ?? null,
    lastEdited: page.last_edited_time ?? null,
  };
}

/** Search pages the user shared with the DeepHaus connection. */
export async function searchNotionPages(
  userId: string,
  query?: string,
  cursor?: string,
): Promise<{ pages: NotionPageSummary[]; nextCursor: string | null }> {
  const body: Record<string, unknown> = {
    filter: { property: "object", value: "page" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    page_size: 25,
  };
  if (query?.trim()) body.query = query.trim();
  if (cursor) body.start_cursor = cursor;

  const data = await notionJson<NotionSearchResponse>(userId, "/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const pages = (data.results ?? [])
    .filter((r) => r.object === "page")
    .map(toPageSummary);
  return { pages, nextCursor: data.has_more ? data.next_cursor : null };
}

/** Fetch a single page's metadata (title, canonical URL). */
export async function getNotionPage(
  userId: string,
  pageId: string,
): Promise<NotionPageSummary> {
  const page = await notionJson<NotionPageObject>(userId, `/pages/${pageId}`, {
    method: "GET",
  });
  return toPageSummary(page);
}

/**
 * Extract the page id from a canonical Notion URL (used for re-sync, where the
 * source row stores the page URL in storage_path). Notion URLs end with the
 * 32-hex-char page id, e.g. notion.so/My-Page-1234...abcd.
 */
export function notionPageIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/([0-9a-f]{32})(?:[?#].*)?$/i);
  return match?.[1] ?? null;
}
