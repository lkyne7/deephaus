import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { requiredCardMedia, type LibraryCardMedia } from "@deephaus/shared";
/** All owned cards; due media comes first, followed by the rest of the library. */
export async function getLibraryMedia(
  db: AbstractPowerSyncDatabase,
  userId: string,
) {
  const rows = await db.getAll<LibraryCardMedia>(
    `SELECT c.front,c.back,c.cloze_text,c.extra,c.occlusion_data
 FROM cards c JOIN generation_jobs g ON g.id=c.job_id JOIN sources s ON s.id=g.source_id JOIN projects p ON p.id=s.project_id
 LEFT JOIN (SELECT card_id,MIN(due) due FROM card_reviews WHERE user_id=? GROUP BY card_id) r ON r.card_id=c.id
 WHERE p.user_id=? ORDER BY CASE WHEN julianday(r.due)<=julianday('now') THEN 0 ELSE 1 END,r.due,c.id`,
    [userId, userId],
  );
  return [...new Set(rows.flatMap(requiredCardMedia))];
}
