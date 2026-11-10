import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import { examStudyOverlap } from "@deephaus/shared";
import { readyExams } from "@/lib/study/session";

export type ReviewDeck = { id: string; name: string; due: number; fresh: number };

export type ReviewSegment = {
  key: string;
  kind: "done" | "due" | "new";
  /** The deck a due slice belongs to; null for done, new and merged slices. */
  deckId: string | null;
  value: number;
};

export type ReviewBreakdown = {
  ready: number;
  done: number;
  due: number;
  fresh: number;
  /** Decks with something to study, most due first. */
  decks: ReviewDeck[];
  /** Done, then each deck's due cards, then new: the bar under the headline. */
  segments: ReviewSegment[];
};

/** Decks drawn as their own slice of the bar; the rest share one. */
export const MAX_DECK_SEGMENTS = 5;

/** Today's review, split by deck, so the bar can show where the due cards are. */
export function reviewBreakdown(stats: DashboardStats): ReviewBreakdown {
  const decks = stats.per_deck
    .filter((deck) => deck.due + deck.new > 0)
    .map((deck) => ({ id: deck.deck_id, name: deck.name, due: deck.due, fresh: deck.new }))
    .sort((a, b) => b.due - a.due || b.fresh - a.fresh);

  const withDue = decks.filter((deck) => deck.due > 0);
  const own = withDue.slice(0, MAX_DECK_SEGMENTS);
  const restDue = withDue.slice(MAX_DECK_SEGMENTS).reduce((sum, deck) => sum + deck.due, 0);

  const segments: ReviewSegment[] = [];
  if (stats.reviewed_today > 0) {
    segments.push({ key: "done", kind: "done", deckId: null, value: stats.reviewed_today });
  }
  for (const deck of own) {
    segments.push({ key: `due-${deck.id}`, kind: "due", deckId: deck.id, value: deck.due });
  }
  if (restDue > 0) segments.push({ key: "due-rest", kind: "due", deckId: null, value: restDue });
  if (stats.new_today_remaining > 0) {
    segments.push({ key: "new", kind: "new", deckId: null, value: stats.new_today_remaining });
  }

  return {
    ready: stats.due_now + stats.new_today_remaining,
    done: stats.reviewed_today,
    due: stats.due_now,
    fresh: stats.new_today_remaining,
    decks,
    segments,
  };
}

/** Rough per-card review pace used only for the time estimate. */
const SECONDS_PER_CARD = 9;

/** "9 min", "1 hr 5 min": short enough to sit beside the headline. */
export function estimateMinutes(cards: number): string {
  const minutes = Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

type HomeExam = Pick<
  ExamSummaryDto,
  "name" | "status" | "exam_at" | "ready_now" | "ready_by_deck"
>;

/** What Home's Study button starts: every exam with cards ready, then every deck with work. */
export type HomeStudy = {
  /** Cards waiting in that session: due, new, and what the exams add on top. */
  ready: number;
  /** False only when there is nothing to study, in regular study or for an exam. */
  hasWork: boolean;
  /** One short line under the button: roughly how long, and what is for an exam. */
  line: string;
};

/**
 * Today's study for Home. An exam and a deck often want the same cards, so the
 * count is regular due + regular new + only what the exams add (cards they
 * want early, and new cards beyond the decks' own). Pass no exams while the
 * exam list is loading or if it failed: the deck numbers stand on their own.
 */
export function homeStudy(stats: DashboardStats, exams: readonly HomeExam[]): HomeStudy {
  const upcoming = readyExams(exams);
  const extra = examStudyOverlap(
    upcoming,
    stats.per_deck.map((deck) => ({ id: deck.deck_id, due: deck.due, new: deck.new })),
  ).extra;
  const examCards = upcoming.reduce((sum, exam) => sum + exam.ready_now, 0);
  // Never fewer than the exams' own ready cards, even from an exam list
  // without the per-deck split the overlap is worked out from.
  const ready = Math.max(stats.due_now + stats.new_today_remaining + extra, examCards);

  const parts = [`About ${estimateMinutes(ready)}`];
  if (upcoming.length === 1) parts.push(`${examCards} for ${upcoming[0].name.trim() || "your exam"}`);
  else if (upcoming.length > 1) parts.push(`${examCards} for ${upcoming.length} exams`);

  return { ready, hasWork: ready > 0, line: parts.join(" · ") };
}

/** Time-of-day greeting with the first name when there is one. */
export function welcomeLine(hour: number, firstName: string, caughtUp: boolean): string {
  const base = caughtUp
    ? "Nice work"
    : hour < 5 || hour >= 18
      ? "Good evening"
      : hour < 12
        ? "Good morning"
        : "Good afternoon";
  return firstName ? `${base}, ${firstName}` : base;
}
