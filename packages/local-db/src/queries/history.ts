import type { AbstractPowerSyncDatabase } from "@powersync/common";
import type { ReviewHistoryEntry } from "@deephaus/scheduling";

/** SQLite caps bound parameters; stay well under it. */
const CARD_ID_CHUNK = 400;

export function reviewHistoryKey(cardId: string, clozeOrd: number): string {
  return `${cardId}:${clozeOrd}`;
}

/**
 * Recorded reviews for these cards, grouped per scheduling unit (card +
 * ordinal). The scheduler rebuilds a card's FSRS-7 memory from this history.
 */
export async function getLocalReviewHistories(
  db: Pick<AbstractPowerSyncDatabase, "getAll">,
  cardIds: readonly string[],
): Promise<Map<string, ReviewHistoryEntry[]>> {
  const histories = new Map<string, ReviewHistoryEntry[]>();
  const unique = [...new Set(cardIds)];
  for (let offset = 0; offset < unique.length; offset += CARD_ID_CHUNK) {
    const chunk = unique.slice(offset, offset + CARD_ID_CHUNK);
    const rows = await db.getAll<{
      card_id: string;
      cloze_ord: number | null;
      rating: number;
      state: number;
      review: string;
      undone: number | null;
    }>(
      `SELECT card_id, cloze_ord, rating, state, review, undone
       FROM review_logs
       WHERE card_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const row of rows) {
      const key = reviewHistoryKey(row.card_id, Number(row.cloze_ord ?? 0));
      const list = histories.get(key) ?? [];
      list.push({
        rating: Number(row.rating),
        state: Number(row.state ?? 0),
        review: row.review,
        undone: row.undone,
      });
      histories.set(key, list);
    }
  }
  return histories;
}
