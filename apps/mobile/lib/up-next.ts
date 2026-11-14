import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import type { Href } from "expo-router";
import type { BackgroundTask, RecentGenerationRun } from "@/lib/background-tasks-context";
import { estimateMinutes, homeStudy } from "@/lib/home-review";
import { recentDecks, type RecentDeck } from "@/lib/recent-decks";
import { readyExams } from "@/lib/study/session";

/** Cards made this recently are offered to learn first, while the source is fresh. */
export const FRESH_WINDOW_MS = 18 * 60 * 60 * 1000;
/** Home's short session, for a bus ride or a queue. */
export const QUICK_SESSION_MINUTES = 5;
/** Roughly how many cards fit in the short session (see estimateMinutes). */
export const QUICK_SESSION_CARDS = 33;
/** Below this the whole day already fits in a short session, so it isn't offered. */
const QUICK_SESSION_MIN_CARDS = 55;
/**
 * A run this recent whose deck isn't in the numbers yet still counts: its
 * cards are syncing down to the phone, and they're all unseen.
 */
const JUST_MADE_MS = 10 * 60 * 1000;
/** Rows under the card on a tall phone. Cards still being made always show, beyond this. */
export const MAX_LINK_ROWS = 3;

/** A run whose cards are waiting to be learned. */
export type FreshRun = {
  deckId: string;
  deckName: string;
  jobId: string;
  /** Its cards the deck still hasn't shown, at most what the run added. */
  cards: number;
  finishedAt: number;
};

/** The one thing Home offers first. */
export type UpNextCard =
  | { kind: "fresh"; run: FreshRun; minutes: string }
  | {
      kind: "study";
      title: string;
      detail: string;
      /** Reviewed so far today, and that plus what's left: the day's progress. */
      done: number;
      total: number;
      /** Whether to offer the short session beside Start. */
      quick: boolean;
    }
  | { kind: "done"; title: string; detail: string };

export type UpNextLinkTone = "study" | "exam" | "deck";

/** What comes after the card: cards being made, a run that failed, other study. */
export type UpNextRow =
  | { kind: "making"; key: string; task: BackgroundTask }
  | { kind: "failed"; key: string; task: BackgroundTask }
  | {
      kind: "link";
      key: string;
      title: string;
      detail: string;
      tone: UpNextLinkTone;
      href: Href;
      /** Today's progress, for the row that continues today's study. */
      progress?: number;
    };

export type UpNext = { card: UpNextCard; rows: UpNextRow[] };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The newest run, made within FRESH_WINDOW_MS, whose deck still has cards it
 * hasn't shown. A run counts as learned once its deck has none left, and as
 * set aside once its notice is dismissed (here or on the deck's Cards tab).
 */
export function pickFreshRun(
  runs: Record<string, RecentGenerationRun>,
  stats: DashboardStats,
  deckNames: ReadonlyMap<string, string>,
  now: number,
  /** Runs still showing as a finished row, which take over the card when it goes. */
  holding?: ReadonlySet<string>,
): FreshRun | null {
  const perDeck = new Map(stats.per_deck.map((deck) => [deck.deck_id, deck]));
  let best: FreshRun | null = null;
  for (const [deckId, run] of Object.entries(runs)) {
    if (run.noticeDismissed || run.cardsAdded <= 0 || holding?.has(run.taskId)) continue;
    if (now - run.finishedAt > FRESH_WINDOW_MS) continue;
    const deck = perDeck.get(deckId);
    if (deck?.paused) continue;
    const unseen = deck
      ? Math.min(run.cardsAdded, deck.new_card_count ?? deck.new)
      : now - run.finishedAt < JUST_MADE_MS
        ? run.cardsAdded
        : 0;
    if (unseen <= 0) continue;
    if (best && best.finishedAt >= run.finishedAt) continue;
    best = {
      deckId,
      deckName: deckNames.get(deckId) ?? deck?.name ?? "your new deck",
      jobId: run.jobId,
      cards: unseen,
      finishedAt: run.finishedAt,
    };
  }
  return best;
}

function deckDetail(deck: RecentDeck): string {
  if (deck.due > 0 && deck.fresh > 0) return `${deck.due} due · ${deck.fresh} new`;
  return deck.due > 0 ? `${deck.due} due` : `${deck.fresh} new`;
}

/**
 * Home's Up next: one card for what to do now, and a few rows for what comes
 * after. In order of preference the card offers cards just made (learning them
 * soon after the source is the point of making them), then today's study, then
 * a finished day. Cards being made, and runs that failed, lead the rows.
 */
export function upNext({
  stats,
  exams,
  projects,
  runs,
  tasks,
  finishing,
  deckNames,
  now,
  maxLinks = MAX_LINK_ROWS,
}: {
  stats: DashboardStats;
  exams: readonly ExamSummaryDto[];
  projects: Project[];
  runs: Record<string, RecentGenerationRun>;
  tasks: readonly BackgroundTask[];
  /**
   * Runs that have just finished and are about to become the card. They stay
   * as a finished row until then, so the row hands over to the card.
   */
  finishing?: ReadonlySet<string>;
  deckNames: ReadonlyMap<string, string>;
  now: number;
  /** How many study rows fit under the card on this phone. */
  maxLinks?: number;
}): UpNext {
  const study = homeStudy(stats, exams);
  const fresh = pickFreshRun(runs, stats, deckNames, now, finishing);
  const exam = readyExams(exams)[0];
  const examCards = readyExams(exams).reduce((sum, item) => sum + item.ready_now, 0);
  const newCards = Math.min(stats.new_today_remaining, study.ready);
  const reviews = study.ready - newCards;

  let card: UpNextCard;
  if (fresh) {
    card = { kind: "fresh", run: fresh, minutes: estimateMinutes(fresh.cards) };
  } else if (study.hasWork) {
    const parts = [`About ${estimateMinutes(study.ready)}`];
    if (reviews > 0 && newCards > 0) parts.push(`${newCards} new`);
    if (exam && examCards > 0) {
      parts.push(`${examCards} for ${exam.name.trim() || "your exam"}`);
    }
    card = {
      kind: "study",
      title: reviews > 0 ? `Review ${plural(reviews, "card")}` : `Learn ${plural(newCards, "new card")}`,
      detail: parts.join(" · "),
      done: stats.reviewed_today,
      total: stats.reviewed_today + study.ready,
      quick: study.ready >= QUICK_SESSION_MIN_CARDS,
    };
  } else {
    const studied = stats.reviewed_today + stats.cards_learned_today;
    card =
      studied > 0
        ? {
            kind: "done",
            title: "Done for today",
            detail:
              stats.streak > 1
                ? `${plural(stats.reviewed_today, "card")} today · ${stats.streak}-day streak`
                : `${plural(stats.reviewed_today, "card")} reviewed today`,
          }
        : {
            kind: "done",
            title: "Nothing due today",
            detail: "Make some cards below, or come back tomorrow.",
          };
  }

  const rows: UpNextRow[] = [];
  const generation = tasks
    .filter((task) => task.kind === "generation")
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const task of generation) {
    if (task.status === "running" || (task.status === "ready" && finishing?.has(task.id))) {
      rows.push({ kind: "making", key: task.id, task });
    }
    if (task.status === "failed") rows.push({ kind: "failed", key: task.id, task });
  }

  const links: UpNextRow[] = [];
  if (card.kind === "fresh" && study.hasWork) {
    const total = stats.reviewed_today + study.ready;
    links.push({
      kind: "link",
      key: "today",
      title: "Today's cards",
      detail: `${study.ready} left · ${estimateMinutes(study.ready)}`,
      tone: "study",
      href: "/study/all",
      progress: total > 0 ? stats.reviewed_today / total : 0,
    });
  }
  if (exam) {
    links.push({
      kind: "link",
      key: `exam-${exam.id}`,
      title: exam.name.trim() || "Your exam",
      detail: `${exam.ready_now} ready`,
      tone: "exam",
      href: { pathname: "/study/exam/[examId]", params: { examId: exam.id } },
    });
  }
  const withWork = recentDecks(projects, stats).filter(
    (deck) => deck.due + deck.fresh > 0 && deck.id !== fresh?.deckId,
  );
  // A single deck's work is all of today's study, which the card already starts.
  if (withWork.length > 1 || exam || card.kind === "fresh") {
    for (const deck of withWork) {
      links.push({
        kind: "link",
        key: `deck-${deck.id}`,
        title: deck.title,
        detail: deckDetail(deck),
        tone: "deck",
        href: { pathname: "/study/[deckId]", params: { deckId: deck.id } },
      });
    }
  }

  return { card, rows: [...rows, ...links.slice(0, maxLinks)] };
}
