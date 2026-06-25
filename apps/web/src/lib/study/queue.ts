import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractClozeOrdinals,
  occlusionOrdinals,
  parseImageOcclusionData,
  studyQueueKey,
} from "@deephaus/shared";
import type { CardReviewRow } from "@/lib/fsrs/scheduler";

export type StudyCardRow = {
  id: string;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags: string[];
  sort_order: number;
};

/** Lightweight row for discovering new queue items without loading full card bodies. */
export type StudyCardMeta = Pick<
  StudyCardRow,
  "id" | "type" | "cloze_text" | "occlusion_data" | "sort_order"
>;

export type StudyReviewRow = CardReviewRow & {
  card_id: string;
  cloze_ord: number;
  suspended: boolean;
};

export type StudyQueueItem = {
  card: StudyCardRow;
  cloze_ord: number | null;
  review: StudyReviewRow | null;
  queue_key: string;
};

type DueReviewRow = StudyReviewRow & {
  cards: StudyCardRow & {
    generation_jobs:
      | { sources: { project_id: string } | { project_id: string }[] }
      | Array<{ sources: { project_id: string } | { project_id: string }[] }>;
  };
};

function unwrapProjectId(row: DueReviewRow): string | null {
  const gj = Array.isArray(row.cards.generation_jobs)
    ? row.cards.generation_jobs[0]
    : row.cards.generation_jobs;
  if (!gj) return null;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  return src?.project_id ?? null;
}

function groupReviewsByCard(reviews: StudyReviewRow[]): Map<string, StudyReviewRow[]> {
  const map = new Map<string, StudyReviewRow[]>();
  for (const review of reviews) {
    const list = map.get(review.card_id) ?? [];
    list.push(review);
    map.set(review.card_id, list);
  }
  return map;
}

function clozeOrdForQueue(card: Pick<StudyCardRow, "type">, reviewOrd: number): number | null {
  if (reviewOrd <= 0) return null;
  if (card.type === "cloze" || card.type === "image-occlusion") return reviewOrd;
  return null;
}

/** Due reviews for a deck with card content — one row per (card, cloze_ord). */
export async function fetchDueStudyRows(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  nowIso: string,
) {
  const { data, error } = await supabase
    .from("card_reviews")
    .select(
      `card_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, suspended,
      cards!inner (
        id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order,
        generation_jobs!inner ( sources!inner ( project_id ) )
      )`,
    )
    .eq("user_id", userId)
    .eq("suspended", false)
    .lte("due", nowIso)
    .neq("state", 0)
    .eq("cards.generation_jobs.sources.project_id", deckId);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const cardsRaw = row.cards;
    const card = Array.isArray(cardsRaw) ? cardsRaw[0] : cardsRaw;
    if (!card || typeof card !== "object") return [];
    const normalized = { ...row, cards: card } as DueReviewRow;
    return unwrapProjectId(normalized) === deckId ? [normalized] : [];
  });
}

export async function fetchDeckCardMetadata(
  supabase: SupabaseClient,
  deckId: string,
): Promise<StudyCardMeta[]> {
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, type, cloze_text, occlusion_data, sort_order, generation_jobs!inner(sources!inner(project_id))",
    )
    .eq("generation_jobs.sources.project_id", deckId)
    .order("sort_order");

  if (error) throw new Error(error.message);
  return (data ?? []) as StudyCardMeta[];
}

/** All review rows for a deck via join — avoids loading every card id first. */
export async function fetchDeckReviewsForProject(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<StudyReviewRow[]> {
  const { data, error } = await supabase
    .from("card_reviews")
    .select(
      `card_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, suspended,
      cards!inner ( generation_jobs!inner ( sources!inner ( project_id ) ) )`,
    )
    .eq("user_id", userId)
    .eq("cards.generation_jobs.sources.project_id", deckId);

  if (error) throw new Error(error.message);
  return (data ?? []) as StudyReviewRow[];
}

export async function fetchCardContentByIds(
  supabase: SupabaseClient,
  cardIds: string[],
): Promise<Map<string, StudyCardRow>> {
  if (cardIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("cards")
    .select("id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order")
    .in("id", cardIds);

  if (error) throw new Error(error.message);

  return new Map(((data ?? []) as StudyCardRow[]).map((row) => [row.id, row]));
}

export function mapDueRowToQueueItem(row: DueReviewRow): StudyQueueItem {
  const card = dueRowToCard(row);
  const clozeOrd = clozeOrdForQueue(card, row.cloze_ord);
  return {
    card,
    cloze_ord: clozeOrd,
    review: {
      card_id: row.card_id,
      cloze_ord: row.cloze_ord,
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      scheduled_days: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
      last_review: row.last_review,
      learning_steps: row.learning_steps,
      suspended: row.suspended,
    },
    queue_key: studyQueueKey(card.id, clozeOrd),
  };
}

function reviewsForCard(reviews: StudyReviewRow[], cardId: string): StudyReviewRow[] {
  return reviews.filter((r) => r.card_id === cardId);
}

function reviewForOrdinal(reviews: StudyReviewRow[], ord: number): StudyReviewRow | null {
  return reviews.find((r) => r.cloze_ord === ord) ?? null;
}

export function expandCardToQueueItems(
  card: StudyCardRow,
  reviews: StudyReviewRow[],
): StudyQueueItem[] {
  if (card.type === "image-occlusion") {
    const data = parseImageOcclusionData(card.occlusion_data);
    const ords = data ? occlusionOrdinals(data) : [];
    if (ords.length === 0) {
      const review = reviewForOrdinal(reviews, 0) ?? reviews[0] ?? null;
      return [
        {
          card,
          cloze_ord: null,
          review,
          queue_key: studyQueueKey(card.id, null),
        },
      ];
    }
    const cardReviews = reviewsForCard(reviews, card.id);
    return ords.map((ord) => ({
      card,
      cloze_ord: ord,
      review: reviewForOrdinal(cardReviews, ord),
      queue_key: studyQueueKey(card.id, ord),
    }));
  }

  if (card.type !== "cloze" || !card.cloze_text) {
    const review = reviewForOrdinal(reviews, 0) ?? reviews[0] ?? null;
    return [
      {
        card,
        cloze_ord: null,
        review,
        queue_key: studyQueueKey(card.id, null),
      },
    ];
  }

  const ords = extractClozeOrdinals(card.cloze_text);
  if (ords.length === 0) {
    const review = reviewForOrdinal(reviews, 0) ?? reviews[0] ?? null;
    return [
      {
        card,
        cloze_ord: null,
        review,
        queue_key: studyQueueKey(card.id, null),
      },
    ];
  }

  const cardReviews = reviewsForCard(reviews, card.id);
  return ords.map((ord) => ({
    card,
    cloze_ord: ord,
    review: reviewForOrdinal(cardReviews, ord),
    queue_key: studyQueueKey(card.id, ord),
  }));
}

export function buildNewQueueItems(
  metadata: StudyCardMeta[],
  reviewsByCard: Map<string, StudyReviewRow[]>,
): StudyQueueItem[] {
  const newItems: StudyQueueItem[] = [];

  for (const meta of metadata) {
    const placeholder: StudyCardRow = {
      ...meta,
      front: null,
      back: null,
      extra: null,
      tags: [],
    };
    const expanded = expandCardToQueueItems(placeholder, reviewsByCard.get(meta.id) ?? []);
    for (const item of expanded) {
      if (isNewStudyItem(item)) newItems.push(item);
    }
  }

  return newItems;
}

export async function hydrateQueueItemsContent(
  supabase: SupabaseClient,
  items: StudyQueueItem[],
): Promise<StudyQueueItem[]> {
  const ids = [...new Set(items.map((item) => item.card.id))];
  const contentById = await fetchCardContentByIds(supabase, ids);

  return items.map((item) => {
    const content = contentById.get(item.card.id);
    if (!content) return item;
    return {
      ...item,
      card: {
        ...content,
        sort_order: item.card.sort_order,
      },
    };
  });
}

export type StudySessionQueue = {
  due: StudyQueueItem[];
  newItems: StudyQueueItem[];
  newTotal: number;
};

/** Count of new cards available in a deck (excludes suspended). Indexed RPC. */
export async function countNewStudyCards(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_new_study_cards", {
    p_deck_id: deckId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Count of due review items for a deck — mirrors {@link fetchDueStudyRows} filters. */
export async function countDueStudyCards(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  nowIso: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_due_study_cards", {
    p_deck_id: deckId,
    p_user_id: userId,
    p_now: nowIso,
  });

  if (error) {
    // RPC missing before migration is applied — fall back to row fetch.
    if (error.code === "PGRST202" || /count_due_study_cards/i.test(error.message ?? "")) {
      return (await fetchDueStudyRows(supabase, deckId, userId, nowIso)).length;
    }
    throw new Error(error.message || error.details || "count_due_study_cards failed");
  }

  return Number(data ?? 0);
}

/** New-card candidates for a deck — pre-filtered and sorted in SQL (with content). */
export async function fetchNewStudyCandidates(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  limit: number,
): Promise<StudyCardRow[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase.rpc("fetch_new_study_cards", {
    p_deck_id: deckId,
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Omit<StudyCardRow, "tags">>).map((row) => ({
    ...row,
    tags: [],
  }));
}

/** Full per-(card, ord) review rows for a small set of cards (new-ordinal detection). */
export async function fetchReviewsForCards(
  supabase: SupabaseClient,
  userId: string,
  cardIds: string[],
): Promise<StudyReviewRow[]> {
  if (cardIds.length === 0) return [];
  const { data, error } = await supabase
    .from("card_reviews")
    .select(
      "card_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, suspended",
    )
    .eq("user_id", userId)
    .in("card_id", cardIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as StudyReviewRow[];
}

/** Expand candidate cards (deduped) into their *new* queue items. */
function buildNewItemsFromCards(
  cards: StudyCardRow[],
  reviewsByCard: Map<string, StudyReviewRow[]>,
): StudyQueueItem[] {
  const items: StudyQueueItem[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    for (const item of expandCardToQueueItems(card, reviewsByCard.get(card.id) ?? [])) {
      if (isNewStudyItem(item)) items.push(item);
    }
  }
  return items;
}

/**
 * Build a study session without loading the whole deck. Due rows come straight
 * from an indexed join; new candidates are fetched pre-filtered/sorted in SQL
 * (bounded by the new-card supply) instead of scanning every card + review.
 */
export async function buildStudySessionQueue(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  nowIso: string,
  newSupply: number,
): Promise<StudySessionQueue> {
  // Each candidate card yields >=1 new item, so fetching a small multiple of the
  // supply (plus headroom for cloze expansion) is enough to fill the new slice.
  const candidateLimit = newSupply > 0 ? newSupply * 4 + 50 : 0;

  const [dueRows, newTotal, candidates] = await Promise.all([
    fetchDueStudyRows(supabase, deckId, userId, nowIso),
    countNewStudyCards(supabase, deckId, userId),
    fetchNewStudyCandidates(supabase, deckId, userId, candidateLimit),
  ]);

  const due = sortDueQueueItems(dueRows.map(mapDueRowToQueueItem));

  let newItems: StudyQueueItem[] = [];
  if (newSupply > 0 && candidates.length > 0) {
    const ids = [...new Set(candidates.map((card) => card.id))];
    const reviewsByCard = groupReviewsByCard(await fetchReviewsForCards(supabase, userId, ids));
    const allNew = sortNewQueueItems(buildNewItemsFromCards(candidates, reviewsByCard));
    newItems = await hydrateQueueItemsContent(supabase, allNew.slice(0, newSupply));
  }

  return {
    due,
    newItems,
    newTotal,
  };
}

export function isNewStudyItem(item: StudyQueueItem): boolean {
  if (item.review?.suspended) return false;
  return !item.review || item.review.state === 0;
}

export function isDueStudyItem(item: StudyQueueItem, nowIso: string): boolean {
  if (!item.review || item.review.suspended || item.review.state === 0) return false;
  return item.review.due <= nowIso;
}

/** @deprecated Scans entire deck with full card bodies — prefer buildStudySessionQueue. */
export function buildExpandedStudyQueue(
  cards: StudyCardRow[],
  reviews: StudyReviewRow[],
  nowIso: string,
): { due: StudyQueueItem[]; newItems: StudyQueueItem[] } {
  const due: StudyQueueItem[] = [];
  const newItems: StudyQueueItem[] = [];
  const reviewsByCard = groupReviewsByCard(reviews);

  for (const card of cards) {
    const expanded = expandCardToQueueItems(card, reviewsByCard.get(card.id) ?? []);
    for (const item of expanded) {
      if (isDueStudyItem(item, nowIso)) due.push(item);
      else if (isNewStudyItem(item)) newItems.push(item);
    }
  }

  return { due, newItems };
}

export async function countNewReviewsTodayForDeck(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  startOfDayIso: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_new_reviews_today_for_deck", {
    p_deck_id: deckId,
    p_user_id: userId,
    p_start_of_day: startOfDayIso,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export function sortDueQueueItems(items: StudyQueueItem[]) {
  return [...items].sort((a, b) => {
    const ra = a.review;
    const rb = b.review;
    if (!ra || !rb) return 0;
    const pa = ra.state === 1 || ra.state === 3 ? 0 : 1;
    const pb = rb.state === 1 || rb.state === 3 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(ra.due).getTime() - new Date(rb.due).getTime();
  });
}

export function sortNewQueueItems(items: StudyQueueItem[]) {
  return [...items].sort((a, b) => {
    const order = a.card.sort_order - b.card.sort_order;
    if (order !== 0) return order;
    return (a.cloze_ord ?? 0) - (b.cloze_ord ?? 0);
  });
}

export function reviewFieldsFromItem(item: StudyQueueItem): CardReviewRow & {
  card_id: string;
  cloze_ord: number;
} {
  const review = item.review;
  const clozeOrd = item.cloze_ord ?? 0;
  if (!review) {
    return {
      card_id: item.card.id,
      cloze_ord: clozeOrd,
      due: new Date().toISOString(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      last_review: null,
      learning_steps: 0,
    };
  }
  return {
    card_id: review.card_id,
    cloze_ord: review.cloze_ord,
    due: review.due,
    stability: review.stability,
    difficulty: review.difficulty,
    elapsed_days: review.elapsed_days,
    scheduled_days: review.scheduled_days,
    reps: review.reps,
    lapses: review.lapses,
    state: review.state,
    last_review: review.last_review,
    learning_steps: review.learning_steps,
  };
}

export function dueRowToCard(row: DueReviewRow): StudyCardRow {
  return {
    id: row.cards.id,
    type: row.cards.type,
    front: row.cards.front,
    back: row.cards.back,
    cloze_text: row.cards.cloze_text,
    extra: row.cards.extra,
    occlusion_data: row.cards.occlusion_data ?? null,
    tags: row.cards.tags ?? [],
    sort_order: row.cards.sort_order,
  };
}

/** @deprecated */
export function reviewFieldsFromDueRow(row: DueReviewRow): CardReviewRow & { card_id: string } {
  return {
    card_id: row.card_id,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review,
    learning_steps: row.learning_steps,
  };
}

/** @deprecated */
export function sortDueRows(rows: DueReviewRow[]) {
  return [...rows].sort((a, b) => {
    const pa = a.state === 1 || a.state === 3 ? 0 : 1;
    const pb = b.state === 1 || b.state === 3 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}
