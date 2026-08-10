// Pure (storage-agnostic) study queue domain logic, shared by the web API
// routes and the offline local-db query layer.
import {
  extractClozeOrdinals,
  occlusionOrdinals,
  parseImageOcclusionData,
  studyQueueKey,
} from "@deephaus/shared";
import type { CardReviewRow } from "./fsrs";

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
export type StudyCardMeta = Pick<StudyCardRow, "id" | "type" | "cloze_text" | "sort_order">;

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

/**
 * Anki-style learn-ahead: when nothing else is due, learning/relearning cards
 * due within this window are pulled forward so the session doesn't stall.
 */
export const LEARN_AHEAD_LIMIT_MINUTES = 20;

export function groupReviewsByCard(reviews: StudyReviewRow[]): Map<string, StudyReviewRow[]> {
  const map = new Map<string, StudyReviewRow[]>();
  for (const review of reviews) {
    const list = map.get(review.card_id) ?? [];
    list.push(review);
    map.set(review.card_id, list);
  }
  return map;
}

export function clozeOrdForQueue(
  card: Pick<StudyCardRow, "type">,
  reviewOrd: number,
): number | null {
  if (reviewOrd <= 0) return null;
  if (card.type === "cloze" || card.type === "image-occlusion") return reviewOrd;
  return null;
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

  if (card.type === "cloze") {
    if (!card.cloze_text) return [];
    const ords = extractClozeOrdinals(card.cloze_text);
    // Cloze cards with no deletions are not studyable.
    if (ords.length === 0) return [];

    const cardReviews = reviewsForCard(reviews, card.id);
    return ords.map((ord) => ({
      card,
      cloze_ord: ord,
      review: reviewForOrdinal(cardReviews, ord),
      queue_key: studyQueueKey(card.id, ord),
    }));
  }

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

export function isNewStudyItem(item: StudyQueueItem): boolean {
  if (item.review?.suspended) return false;
  return !item.review || item.review.state === 0;
}

export function isDueStudyItem(item: StudyQueueItem, nowIso: string): boolean {
  if (!item.review || item.review.suspended || item.review.state === 0) return false;
  return item.review.due <= nowIso;
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

/** Expand candidate cards (deduped) into their *new* queue items. */
export function buildNewItemsFromCards(
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
