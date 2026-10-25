import type { AbstractPowerSyncDatabase } from "@powersync/common";

export interface LocalSourceDocument {
  content: unknown;
  sourceType: string;
  contentEditedAt: string | null;
}

/**
 * The editable document for a source, when it has already been seeded.
 * Returns null for unseeded sources — first-time seeding requires server-side
 * file extraction, so callers should fall through to the network.
 *
 * Note that `sources.edited_content` is currently excluded from the sync stream
 * (see powersync/sync-streams.yaml), so this only resolves for documents edited
 * locally since the last sync; otherwise callers always reach the network.
 */
export async function getLocalSourceDocument(
  db: AbstractPowerSyncDatabase,
  sourceId: string,
): Promise<LocalSourceDocument | null> {
  const row = await db.getOptional<{
    type: string;
    edited_content: string | null;
    content_edited_at: string | null;
  }>(
    `SELECT type, edited_content, content_edited_at FROM sources WHERE id = ?`,
    [sourceId],
  );
  if (!row?.edited_content) return null;
  try {
    return {
      content: JSON.parse(row.edited_content),
      sourceType: row.type,
      contentEditedAt: row.content_edited_at,
    };
  } catch {
    return null;
  }
}

/** A save was based on a version other than the one stored locally. */
export class SourceDocumentConflictError extends Error {
  constructor(readonly currentEditedAt: string | null) {
    super("This document was changed in another tab or device. Reload it before saving.");
    this.name = "SourceDocumentConflictError";
  }
}

/**
 * True when two content_edited_at values name the same document version. The
 * server returns ISO strings while PowerSync replicates timestamptz in its own
 * text format, so compare instants rather than strings.
 */
export function isSameSourceDocumentVersion(
  current: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (current == null || expected == null) return current == null && expected == null;
  if (current === expected) return true;
  const a = parseInstant(current);
  const b = parseInstant(expected);
  return Number.isFinite(a) && a === b;
}

/**
 * Milliseconds since the epoch for an ISO, PostgREST or PowerSync timestamp, or
 * NaN. PowerSync's form ("2026-10-19 12:00:05.123456Z") uses a space and
 * microseconds, which Safari's Date.parse rejects, so normalise it to ISO first.
 */
function parseInstant(value: string): number {
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}

/**
 * Persist source edits locally (PUT /api/sources/:id/document). Server-side
 * chunk-cache invalidation happens via a trigger on content_edited_at when
 * the write replicates.
 *
 * Every tab shares the local replica, so the save is checked against the
 * version the editor loaded (`expectedEditedAt`, null for a never-edited
 * document) and throws {@link SourceDocumentConflictError} on a mismatch.
 */
export async function saveLocalSourceDocument(
  db: AbstractPowerSyncDatabase,
  input: {
    sourceId: string;
    /** ProseMirror doc as a JSON object. */
    content: unknown;
    /** Plain text derived from the doc (keeps generation working). */
    rawText: string;
    /** content_edited_at of the version being edited. */
    expectedEditedAt: string | null;
  },
): Promise<{ contentEditedAt: string }> {
  const editedAt = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const row = await tx.getOptional<{ content_edited_at: string | null }>(
      `SELECT content_edited_at FROM sources WHERE id = ?`,
      [input.sourceId],
    );
    if (!row) throw new Error("Source not found");
    if (!isSameSourceDocumentVersion(row.content_edited_at, input.expectedEditedAt)) {
      throw new SourceDocumentConflictError(row.content_edited_at);
    }
    await tx.execute(
      `UPDATE sources SET edited_content = ?, raw_text = ?, content_edited_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(input.content), input.rawText, editedAt, editedAt, input.sourceId],
    );
  });
  return { contentEditedAt: editedAt };
}
