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

/**
 * Persist source edits locally (PUT /api/sources/:id/document). Server-side
 * chunk-cache invalidation happens via a trigger on content_edited_at when
 * the write replicates.
 */
export async function saveLocalSourceDocument(
  db: AbstractPowerSyncDatabase,
  input: {
    sourceId: string;
    /** ProseMirror doc as a JSON object. */
    content: unknown;
    /** Plain text derived from the doc (keeps generation working). */
    rawText: string;
  },
): Promise<{ contentEditedAt: string }> {
  const editedAt = new Date().toISOString();
  const result = await db.execute(
    `UPDATE sources SET edited_content = ?, raw_text = ?, content_edited_at = ?, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify(input.content), input.rawText, editedAt, editedAt, input.sourceId],
  );
  if ((result.rowsAffected ?? 0) === 0) throw new Error("Source not found");
  return { contentEditedAt: editedAt };
}
