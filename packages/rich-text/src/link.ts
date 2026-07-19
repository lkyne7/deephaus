import type { Editor } from "@tiptap/core";

/** Dispatched on the editor DOM when Mod+K requests a new hyperlink. */
export const RICH_TEXT_REQUEST_LINK_EVENT = "dh-rich-text-request-link";

/** Normalize a user-entered URL; returns null when empty. */
export function normalizeLinkHref(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  // Already has a scheme (https:, mailto:, tel:, …).
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // Site-relative / in-page targets.
  if (url.startsWith("/") || url.startsWith("#") || url.startsWith("?")) return url;
  return `https://${url}`;
}

/**
 * Apply a link mark to a range. Uses chainable `setMark` instead of TipTap's
 * `setLink`, which calls `chain().run()` internally and can drop a pending
 * `setTextSelection` after the editor blurs (e.g. for a URL prompt).
 */
export function applyLinkMark(
  editor: Editor,
  href: string,
  range?: { from: number; to: number },
): boolean {
  const normalized = normalizeLinkHref(href);
  if (!normalized || editor.isDestroyed) return false;

  const from = range?.from ?? editor.state.selection.from;
  const to = range?.to ?? editor.state.selection.to;
  if (from >= to) return false;

  return editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setMark("link", { href: normalized })
    .run();
}

export function unsetLinkMark(editor: Editor): boolean {
  if (editor.isDestroyed) return false;
  return editor.chain().focus().extendMarkRange("link").unsetMark("link").run();
}
