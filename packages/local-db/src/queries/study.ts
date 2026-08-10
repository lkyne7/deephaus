import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { studyQueueKey } from "@deephaus/shared";
import {
  buildNewItemsFromCards,
  clozeOrdForQueue,
  groupReviewsByCard,
  sortDueQueueItems,
  sortNewQueueItems,
  LEARN_AHEAD_LIMIT_MINUTES,
  type StudyCardRow,
  type StudyQueueItem,
  type StudyReviewRow,
} from "@deephaus/scheduling";

const REVIEW_COLUMNS =
  "cr.card_id, cr.cloze_ord, cr.due, cr.stability, cr.difficulty, cr.elapsed_days, cr.scheduled_days, cr.reps, cr.lapses, cr.state, cr.last_review, cr.learning_steps, cr.suspended";

const CARD_COLUMNS =
  "c.id AS c_id, c.type AS c_type, c.front AS c_front, c.back AS c_back, c.cloze_text AS c_cloze_text, c.extra AS c_extra, c.occlusion_data AS c_occlusion_data, c.tags AS c_tags, c.sort_order AS c_sort_order";

/** Deck-scoped join: cards belong to decks via generation_jobs -> sources. */
const DECK_JOIN =
  "JOIN generation_jobs gj ON gj.id = c.job_id JOIN sources s ON s.id = gj.source_id";

type LocalDueRow = Record<string, unknown>;

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToStudyCard(row: LocalDueRow): StudyCardRow {
  return {
    id: String(row.c_id),
    type: String(row.c_type),
    front: (row.c_front as string | null) ?? null,
    back: (row.c_back as string | null) ?? null,
    cloze_text: (row.c_cloze_text as string | null) ?? null,
    extra: (row.c_extra as string | null) ?? null,
    occlusion_data: parseJson(row.c_occlusion_data),
    tags: parseTags(row.c_tags),
    sort_order: Number(row.c_sort_order ?? 0),
  };
}

function rowToStudyReview(row: LocalDueRow): StudyReviewRow {
  return {
    card_id: String(row.card_id),
    cloze_ord: Number(row.cloze_ord ?? 0),
    due: String(row.due),
    stability: Number(row.stability ?? 0),
    difficulty: Number(row.difficulty ?? 0),
    elapsed_days: Number(row.elapsed_days ?? 0),
    scheduled_days: Number(row.scheduled_days ?? 0),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    state: Number(row.state ?? 0),
    last_review: (row.last_review as string | null) ?? null,
    learning_steps: Number(row.learning_steps ?? 0),
    suspended: Number(row.suspended ?? 0) !== 0,
  };
}

function dueRowToQueueItem(row: LocalDueRow): StudyQueueItem {
  const card = rowToStudyCard(row);
  const review = rowToStudyReview(row);
  const clozeOrd = clozeOrdForQueue(card, review.cloze_ord);
  return {
    card,
    cloze_ord: clozeOrd,
    review,
    queue_key: studyQueueKey(card.id, clozeOrd),
  };
}

/** Due reviews for a deck with card content — one row per (card, cloze_ord). */
export async function fetchLocalDueRows(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  nowIso: string,
): Promise<StudyQueueItem[]> {
  const rows = await db.getAll<LocalDueRow>(
    `SELECT ${REVIEW_COLUMNS}, ${CARD_COLUMNS}
     FROM card_reviews cr
     JOIN cards c ON c.id = cr.card_id
     ${DECK_JOIN}
     WHERE s.project_id = ?
       AND cr.suspended = 0
       AND cr.due <= ?
       AND cr.state != 0`,
    [deckId, nowIso],
  );
  return rows.map(dueRowToQueueItem);
}

/** Learning/relearning cards inside the learn-ahead window (strictly after now). */
export async function fetchLocalLearnAheadRows(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  nowIso: string,
  learnAheadMinutes = LEARN_AHEAD_LIMIT_MINUTES,
): Promise<StudyQueueItem[]> {
  const horizonIso = new Date(
    new Date(nowIso).getTime() + learnAheadMinutes * 60_000,
  ).toISOString();
  const rows = await db.getAll<LocalDueRow>(
    `SELECT ${REVIEW_COLUMNS}, ${CARD_COLUMNS}
     FROM card_reviews cr
     JOIN cards c ON c.id = cr.card_id
     ${DECK_JOIN}
     WHERE s.project_id = ?
       AND cr.suspended = 0
       AND cr.due > ?
       AND cr.due <= ?
       AND cr.state IN (1, 3)`,
    [deckId, nowIso, horizonIso],
  );
  return rows.map(dueRowToQueueItem);
}

/** Mirrors the count_new_study_cards RPC against the local replica. */
export async function countLocalNewStudyCards(
  db: AbstractPowerSyncDatabase,
  deckId: string,
): Promise<number> {
  const row = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM cards c
     ${DECK_JOIN}
     LEFT JOIN card_reviews cr ON cr.card_id = c.id
     WHERE s.project_id = ?
       AND COALESCE(cr.suspended, 0) = 0
       AND (cr.card_id IS NULL OR cr.state = 0)`,
    [deckId],
  );
  return Number(row?.count ?? 0);
}

/** Mirrors the count_due_study_cards RPC against the local replica. */
export async function countLocalDueStudyCards(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  nowIso: string,
): Promise<number> {
  const row = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM card_reviews cr
     JOIN cards c ON c.id = cr.card_id
     ${DECK_JOIN}
     WHERE s.project_id = ?
       AND cr.suspended = 0
       AND cr.due <= ?
       AND cr.state != 0`,
    [deckId, nowIso],
  );
  return Number(row?.count ?? 0);
}

/** Mirrors count_new_reviews_today_for_deck: new-card intros since day start. */
export async function countLocalNewReviewsToday(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  startOfDayIso: string,
): Promise<number> {
  const row = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id
     ${DECK_JOIN}
     WHERE s.project_id = ?
       AND rl.state = 0
       AND rl.review >= ?`,
    [deckId, startOfDayIso],
  );
  return Number(row?.count ?? 0);
}

/** Batch form used by deck lists to avoid one SQLite query per deck. */
export async function countLocalNewReviewsTodayByDeck(
  db: AbstractPowerSyncDatabase,
  startOfDayIso: string,
): Promise<Map<string, number>> {
  const rows = await db.getAll<{ deck_id: string; count: number }>(
    `SELECT s.project_id AS deck_id, COUNT(*) AS count
     FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id
     ${DECK_JOIN}
     WHERE rl.state = 0
       AND rl.review >= ?
     GROUP BY s.project_id`,
    [startOfDayIso],
  );
  return new Map(rows.map((row) => [row.deck_id, Number(row.count ?? 0)]));
}

/** Mirrors fetch_new_study_cards: new-card candidates with content, sorted. */
export async function fetchLocalNewCandidates(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  limit: number,
): Promise<StudyCardRow[]> {
  if (limit <= 0) return [];
  const rows = await db.getAll<LocalDueRow>(
    `SELECT DISTINCT ${CARD_COLUMNS}
     FROM cards c
     ${DECK_JOIN}
     LEFT JOIN card_reviews cr ON cr.card_id = c.id
     WHERE s.project_id = ?
       AND COALESCE(cr.suspended, 0) = 0
       AND (cr.card_id IS NULL OR cr.state = 0)
     ORDER BY c.sort_order
     LIMIT ?`,
    [deckId, limit],
  );
  return rows.map(rowToStudyCard);
}

/** Full per-(card, ord) review rows for a set of cards (new-ordinal detection). */
export async function fetchLocalReviewsForCards(
  db: AbstractPowerSyncDatabase,
  cardIds: string[],
): Promise<StudyReviewRow[]> {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  const rows = await db.getAll<LocalDueRow>(
    `SELECT ${REVIEW_COLUMNS}
     FROM card_reviews cr
     WHERE cr.card_id IN (${placeholders})`,
    cardIds,
  );
  return rows.map(rowToStudyReview);
}

export type LocalStudySessionQueue = {
  due: StudyQueueItem[];
  newItems: StudyQueueItem[];
  newTotal: number;
  usedLearnAhead: boolean;
};

/**
 * Local equivalent of the web buildStudySessionQueue: due rows from an indexed
 * join, new candidates bounded by supply, Anki-style learn-ahead fallback.
 */
export async function buildLocalStudySessionQueue(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  nowIso: string,
  newSupply: number,
): Promise<LocalStudySessionQueue> {
  const candidateLimit = newSupply > 0 ? newSupply * 4 + 50 : 0;

  const [dueItems, newTotal, candidates] = await Promise.all([
    fetchLocalDueRows(db, deckId, nowIso),
    countLocalNewStudyCards(db, deckId),
    fetchLocalNewCandidates(db, deckId, candidateLimit),
  ]);

  let due = sortDueQueueItems(dueItems);

  let newItems: StudyQueueItem[] = [];
  if (newSupply > 0 && candidates.length > 0) {
    const ids = [...new Set(candidates.map((card) => card.id))];
    const reviewsByCard = groupReviewsByCard(await fetchLocalReviewsForCards(db, ids));
    const allNew = sortNewQueueItems(buildNewItemsFromCards(candidates, reviewsByCard));
    newItems = allNew.slice(0, newSupply);
  }

  let usedLearnAhead = false;
  if (due.length === 0 && newItems.length === 0) {
    const ahead = await fetchLocalLearnAheadRows(db, deckId, nowIso);
    if (ahead.length > 0) {
      due = sortDueQueueItems(ahead);
      usedLearnAhead = true;
    }
  }

  return { due, newItems, newTotal, usedLearnAhead };
}
