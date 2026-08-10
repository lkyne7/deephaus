import type { AbstractPowerSyncDatabase } from "@powersync/common";

export interface LocalNoteSourceRow {
  id: string;
  type: string;
  title: string | null;
  created_at: string;
  content_edited_at: string | null;
  project_id: string | null;
  deck_name: string | null;
}

/** Raw rows for the notes library (GET /api/notes); callers map titles. */
export async function listLocalNoteSources(
  db: AbstractPowerSyncDatabase,
): Promise<LocalNoteSourceRow[]> {
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT s.id, s.type, s.title, s.created_at, s.content_edited_at, s.project_id,
            COALESCE(NULLIF(p.deck_name, ''), p.name) AS deck_name
     FROM sources s
     LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.type NOT IN ('topic', 'apkg')
     ORDER BY s.created_at DESC
     LIMIT 300`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type ?? "text"),
    title: (row.title as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    content_edited_at: (row.content_edited_at as string | null) ?? null,
    project_id: (row.project_id as string | null) ?? null,
    deck_name: (row.deck_name as string | null) ?? null,
  }));
}

export interface LocalSourceDocument {
  content: unknown;
  sourceType: string;
  contentEditedAt: string | null;
}

/**
 * The editable document for a source, when it has already been seeded.
 * Returns null for unseeded sources — first-time seeding requires server-side
 * file extraction, so callers should fall through to the network.
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
 * Persist note edits locally (PUT /api/sources/:id/document). Server-side
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
