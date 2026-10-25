import type { JSONContent } from "@tiptap/core";
import { apiFetch } from "@/lib/api/fetch";

export type SourceDocumentSaveResult = "saved" | "unchanged" | "conflict" | "error";

type Request = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Saves a source document with optimistic concurrency. Each PUT carries the
 * `contentEditedAt` of the version being edited and adopts the one the server
 * returns. Saves run one at a time so overlapping autosaves from this editor
 * never conflict with each other. After a 409 (the document changed in another
 * tab or device) every later save is refused until the editor reloads.
 */
export function createSourceDocumentSaver(options: {
  sourceId: string;
  /** Version the editor loaded; null for a never-edited document. */
  contentEditedAt: string | null;
  /** Serialized content that is already stored. */
  lastSaved: string;
  request?: Request;
  onSaved?: (content: JSONContent, contentEditedAt: string | null) => void;
}) {
  const request = options.request ?? apiFetch;
  let contentEditedAt = options.contentEditedAt;
  let lastSaved = options.lastSaved;
  let conflicted = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function run(content: JSONContent): Promise<SourceDocumentSaveResult> {
    if (conflicted) return "conflict";
    const serialized = JSON.stringify(content);
    if (serialized === lastSaved) return "unchanged";
    try {
      const res = await request(`/api/sources/${options.sourceId}/document`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, contentEditedAt }),
      });
      if (res.status === 409) {
        conflicted = true;
        return "conflict";
      }
      if (!res.ok) return "error";
      const data = (await res.json()) as { contentEditedAt?: string | null };
      contentEditedAt = data.contentEditedAt ?? null;
      lastSaved = serialized;
      options.onSaved?.(content, contentEditedAt);
      return "saved";
    } catch {
      return "error";
    }
  }

  return {
    save(content: JSONContent): Promise<SourceDocumentSaveResult> {
      const next = queue.then(() => run(content));
      queue = next.catch(() => undefined);
      return next;
    },
    get contentEditedAt() {
      return contentEditedAt;
    },
    get lastSaved() {
      return lastSaved;
    },
    get conflicted() {
      return conflicted;
    },
  };
}
