import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { suspendLocalCard } from "../queries/session";
import { generateUuid } from "../uuid";

export interface LocalCardUpdateFields {
  type?: "basic" | "cloze" | "image-occlusion";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  tags?: string[];
  occlusion_data?: unknown;
  source_chunk_id?: string | null;
  source_ref?: string | null;
  source_quote?: string | null;
}

const UPDATABLE_COLUMNS: Array<keyof LocalCardUpdateFields> = [
  "type",
  "front",
  "back",
  "cloze_text",
  "extra",
  "tags",
  "occlusion_data",
  "source_chunk_id",
  "source_ref",
  "source_quote",
];

/** Edit card content locally; marks user_edited like PUT /api/cards/[id]. */
export async function updateLocalCard(
  db: AbstractPowerSyncDatabase,
  cardId: string,
  fields: LocalCardUpdateFields,
): Promise<void> {
  const sets: string[] = ["user_edited = 1", "updated_at = ?"];
  const args: unknown[] = [new Date().toISOString()];
  for (const key of UPDATABLE_COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    const value = fields[key];
    if (key === "tags" || key === "occlusion_data") {
      args.push(value == null ? null : JSON.stringify(value));
    } else {
      args.push(value ?? null);
    }
  }
  args.push(cardId);
  await db.execute(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`, args);
}

/**
 * Delete a card locally. Postgres cascades reviews/logs/cram items on the
 * server; locally we remove them explicitly so offline views stay consistent
 * (the duplicate uploaded deletes are idempotent).
 */
export async function deleteLocalCard(
  db: AbstractPowerSyncDatabase,
  cardId: string,
): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM card_reviews WHERE card_id = ?`, [cardId]);
    await tx.execute(`DELETE FROM review_logs WHERE card_id = ?`, [cardId]);
    await tx.execute(`DELETE FROM cram_review_logs WHERE card_id = ?`, [cardId]);
    await tx.execute(`DELETE FROM cram_plan_items WHERE card_id = ?`, [cardId]);
    await tx.execute(`DELETE FROM cards WHERE id = ?`, [cardId]);
  });
}

/** Batch suspend/unsuspend/delete, mirroring POST /api/browse/batch. */
export async function batchLocalCardAction(
  db: AbstractPowerSyncDatabase,
  input: {
    userId: string;
    action: "suspend" | "unsuspend" | "delete";
    cardIds: string[];
  },
): Promise<void> {
  for (const cardId of input.cardIds) {
    if (input.action === "delete") {
      await deleteLocalCard(db, cardId);
    } else {
      await suspendLocalCard(db, {
        userId: input.userId,
        cardId,
        suspended: input.action === "suspend",
      });
    }
  }
}

export interface CreateLocalCardInput {
  projectId: string;
  type?: "basic" | "cloze" | "image-occlusion";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  tags?: string[];
  occlusion_data?: unknown;
  source_chunk_id?: string | null;
  source_ref?: string | null;
  source_quote?: string | null;
  /** When true (default), append after existing cards; else insert at top. */
  append?: boolean;
}

/**
 * Create a card locally, mirroring POST /api/cards: attach to the deck's most
 * recent generation job, creating a lightweight manual source/job when the
 * deck has none.
 */
export async function createLocalCard(
  db: AbstractPowerSyncDatabase,
  input: CreateLocalCardInput,
): Promise<{ id: string; job_id: string }> {
  const nowIso = new Date().toISOString();
  const cardId = generateUuid();

  const jobRow = await db.getOptional<{ id: string }>(
    `SELECT gj.id FROM generation_jobs gj
     JOIN sources s ON s.id = gj.source_id
     WHERE s.project_id = ?
     ORDER BY gj.created_at DESC
     LIMIT 1`,
    [input.projectId],
  );

  const maxRow = await db.getOptional<{ sort_order: number }>(
    `SELECT c.sort_order FROM cards c
     JOIN generation_jobs gj ON gj.id = c.job_id
     JOIN sources s ON s.id = gj.source_id
     WHERE s.project_id = ?
     ORDER BY c.sort_order DESC
     LIMIT 1`,
    [input.projectId],
  );
  const baseOrder = maxRow?.sort_order ?? -1;
  const sortOrder = input.append === false ? baseOrder - 1 : baseOrder + 1;

  let jobId = jobRow?.id ?? null;

  await db.writeTransaction(async (tx) => {
    if (!jobId) {
      const sourceId = generateUuid();
      await tx.execute(
        `INSERT INTO sources (id, project_id, type, raw_text, created_at)
         VALUES (?, ?, 'text', '', ?)`,
        [sourceId, input.projectId, nowIso],
      );
      jobId = generateUuid();
      await tx.execute(
        `INSERT INTO generation_jobs (id, source_id, status, progress, created_at, updated_at)
         VALUES (?, ?, 'ready', 100, ?, ?)`,
        [jobId, sourceId, nowIso, nowIso],
      );
    }

    await tx.execute(
      `INSERT INTO cards (
         id, job_id, type, front, back, cloze_text, extra, tags, sort_order,
         user_edited, occlusion_data, source_chunk_id, source_ref, source_quote,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        cardId,
        jobId,
        input.type ?? "basic",
        input.front ?? null,
        input.back ?? null,
        input.cloze_text ?? null,
        input.extra ?? null,
        JSON.stringify(input.tags ?? []),
        sortOrder,
        input.occlusion_data == null ? null : JSON.stringify(input.occlusion_data),
        input.source_chunk_id ?? null,
        input.source_ref ?? null,
        input.source_quote ?? null,
        nowIso,
        nowIso,
      ],
    );
  });

  return { id: cardId, job_id: jobId! };
}
