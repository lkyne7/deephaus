import type {
  ExamQueueResponse,
  ExamSummaryDto,
  ReviewCardPayload,
  StudyQueueResponse,
} from "@deephaus/api-client";
import {
  examStudyOverlap,
  pickReviewDecks,
  type ChainedPage,
  type ExamCardReason,
  type ReviewDeckSummary,
} from "@deephaus/shared";

/**
 * The pure half of the study session: which queues a session studies and in
 * what order, how its "cards left" counts start, and how a queue's page
 * becomes session cards. One deck, one exam and the combined session all read
 * these; the screen itself is components/study/study-session.tsx.
 */

export type StudySourceKind = "deck" | "exam";

/** One queue a session studies: a deck's review queue, or an exam's. */
export type StudySource = { id: string; kind: StudySourceKind };

/** Cards left today. `learning` is counted inside `due`, as the queues send it. */
export type SessionCounts = { due: number; learning: number; new: number };

export const NO_SESSION_COUNTS: SessionCounts = { due: 0, learning: 0, new: 0 };

type DeckQueuePage = StudyQueueResponse & {
  /** Sent when the page was filled by pulling learning cards ahead of time. */
  learn_ahead?: boolean;
};
type ExamQueuePage = ExamQueueResponse & { offline_media_deferred?: number };

/**
 * A queue's page as the session reads it. `dropped` is how many cards the page
 * was sent with that were left out as stale (see `dropStaleCards`).
 */
export type SessionPage = (DeckQueuePage | ExamQueuePage) & { dropped: number };

/** A card in the session, tagged with the queue that served it. */
export type SessionCard = ReviewCardPayload & {
  /** The queue the card came from (a deck or an exam), which owns its counts. */
  source_id: string;
  /** The deck the card lives in. */
  deck_name: string;
  /** Set when an exam's queue served the card: its answer counts towards that exam. */
  exam_id?: string;
  exam_name?: string;
  /** Exam cards only: why the exam wants the card now. */
  reason?: ExamCardReason;
};

type ReadyExam = Pick<ExamSummaryDto, "id" | "status" | "exam_at" | "ready_now" | "ready_by_deck">;

/** Active exams with cards worth studying now, soonest exam first. */
export function readyExams<E extends Pick<ExamSummaryDto, "status" | "exam_at" | "ready_now">>(
  exams: readonly E[],
): E[] {
  return exams
    .filter((exam) => exam.status === "active" && exam.ready_now > 0)
    .sort((a, b) => Date.parse(a.exam_at) - Date.parse(b.exam_at));
}

/**
 * The combined session's queues in study order: exam work first, since it is
 * the part with a deadline, then every deck with work today, due work first.
 */
export function studySources(
  exams: readonly Pick<ExamSummaryDto, "id" | "status" | "exam_at" | "ready_now">[],
  decks: readonly ReviewDeckSummary[],
): StudySource[] {
  return [
    ...readyExams(exams).map((exam) => ({ id: exam.id, kind: "exam" as const })),
    ...pickReviewDecks([...decks]).map((deck) => ({ id: deck.id, kind: "deck" as const })),
  ];
}

/**
 * "Cards left" for the combined session before any queue has loaded. An exam
 * and a deck often want the same cards; the exam's session comes first, so its
 * share is taken off the deck's own counts and no card is counted twice. Each
 * source's entry is replaced by its queue's real counts once that queue loads.
 */
export function seedSessionCounts(
  exams: readonly ReadyExam[],
  decks: readonly ReviewDeckSummary[],
): Record<string, SessionCounts> {
  const ready = readyExams(exams);
  const studied = pickReviewDecks([...decks]);
  const covered = examStudyOverlap(ready, studied).byDeck;
  const counts: Record<string, SessionCounts> = {};
  for (const exam of ready) {
    const byDeck = exam.ready_by_deck ?? [];
    const due = byDeck.reduce((sum, deck) => sum + deck.due + deck.early, 0);
    const fresh = byDeck.reduce((sum, deck) => sum + deck.new, 0);
    counts[exam.id] =
      due + fresh > 0
        ? { due, learning: 0, new: fresh }
        : // No per-deck split to go on: the exam still has its ready cards.
          { due: exam.ready_now, learning: 0, new: 0 };
  }
  for (const deck of studied) {
    const taken = covered.get(deck.id) ?? { due: 0, new: 0 };
    counts[deck.id] = {
      due: Math.max(0, deck.due - taken.due),
      learning: 0,
      new: Math.max(0, deck.new - taken.new),
    };
  }
  return counts;
}

/** A page's own counts, preferring today's remaining new cards over the deck-wide total. */
export function pageCounts(counts: {
  due: number;
  learning: number;
  new: number;
  new_today_remaining?: number;
}): SessionCounts {
  return {
    due: counts.due,
    learning: counts.learning,
    new: counts.new_today_remaining ?? counts.new,
  };
}

/**
 * Leaves out cards answered this session that a page still shows at the
 * review count they had before their grade: that page was read before the
 * grade landed. A card whose count has moved on is a real return (a learning
 * step coming due) and is kept.
 */
export function dropStaleCards<C extends { queue_key: string; reps: number }>(
  cards: readonly C[],
  answered: ReadonlyMap<string, number>,
): C[] {
  return cards.filter((card) => {
    const repsBefore = answered.get(card.queue_key);
    return repsBefore === undefined || card.reps > repsBefore;
  });
}

/**
 * Keys the next page must leave out so no card is shown twice: cards still to
 * come in the session from `index` on, and cards whose grade is still saving.
 */
export function pendingCardKeys(
  queue: readonly { queue_key: string }[],
  index: number,
  saving: Iterable<string>,
): Set<string> {
  return new Set([...queue.slice(index).map((card) => card.queue_key), ...saving]);
}

/** Cards for the session from one queue's page. */
export function sessionCards({ deckId: sourceId, queue }: ChainedPage<SessionPage>): SessionCard[] {
  const exam = "exam" in queue ? queue.exam : null;
  const cards: ReviewCardPayload[] = queue.cards;
  return cards.map((card) => ({
    ...card,
    source_id: sourceId,
    // Exam cards come from several decks and name their own.
    deck_name: (card as { deck_name?: string }).deck_name ?? queue.deck.name,
    ...(exam ? { exam_id: sourceId, exam_name: exam.name } : {}),
  }));
}

/**
 * Cards ready across a queue right now, not only the page that was sent, less
 * the ones left out as stale. An exam session counts down from this.
 */
export function readyOnPage(page: {
  cards: readonly unknown[];
  dropped: number;
  counts: { due: number; new: number };
}): number {
  const sent = page.cards.length + page.dropped;
  const ready = Math.max(sent, page.counts.due + page.counts.new);
  return Math.max(page.cards.length, ready - page.dropped);
}
