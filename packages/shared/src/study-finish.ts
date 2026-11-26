/**
 * The end of a study session: what was done, what is left today, and what the
 * finish page offers next. Pure, so the web and the phone decide alike; each
 * draws the result its own way.
 */

/** How a deck's queue differs from an ordinary day's. All off for normal study. */
export type StudyQueueOptions = {
  /** The day's new-card limit for this session, in place of the deck's own. */
  newLimit?: number;
  /** Serve every due review, past the deck's daily review limit. */
  allReviews?: boolean;
  /** With nothing due, bring up reviews due by the end of tomorrow. */
  ahead?: boolean;
  /** With nothing due, bring up cards still being learned that return later today. */
  learning?: boolean;
};

/** Query string for a deck's queue, without the "?". */
export function studyQueueQuery(options: StudyQueueOptions): string {
  const search = new URLSearchParams();
  if (options.newLimit != null) search.set("newLimit", String(options.newLimit));
  if (options.allReviews) search.set("allReviews", "1");
  if (options.ahead) search.set("ahead", "1");
  if (options.learning) search.set("learning", "1");
  return search.toString();
}

/** Reads the options back from a URL's parameters (a page's or an API route's). */
export function parseStudyQueueOptions(
  get: (key: string) => string | null | undefined,
): StudyQueueOptions {
  const raw = get("newLimit");
  const newLimit = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return {
    ...(Number.isFinite(newLimit) && newLimit >= 0
      ? { newLimit: Math.min(newLimit, MAX_SESSION_NEW_LIMIT) }
      : {}),
    ...(get("allReviews") === "1" ? { allReviews: true } : {}),
    ...(get("ahead") === "1" ? { ahead: true } : {}),
    ...(get("learning") === "1" ? { learning: true } : {}),
  };
}

/** Well above any deck's own limit, so "learn more" always has room. */
export const MAX_SESSION_NEW_LIMIT = 2000;

/** One deck as GET /api/study/finish sends it. */
export type StudyFinishDeck = {
  id: string;
  title: string;
  paused: boolean;
  /** Cards to study now: due, new, and the two together. */
  due: number;
  new: number;
  waiting: number;
  total: number;
  /** Cards never studied. */
  unseen: number;
  /** New cards today's limit is holding back. */
  new_held_back: number;
  /** New cards studied today and the deck's daily limit. */
  new_today: number;
  new_limit: number;
  /** Due reviews the daily review limit left for another day. */
  reviews_held_back: number;
  review_limit: number | null;
  /** Cards being learned that come back later today, and the first of them. */
  returning: number;
  returning_at: string | null;
  /** Reviews due by the end of tomorrow that weren't studied today. */
  ahead: number;
  /** Cards expected tomorrow: due then, left over from today, and new. */
  tomorrow: number;
};

export type StudyFinishResponse = { decks: StudyFinishDeck[] };

// ---------------------------------------------------------------------------
// What was done

export type FinishGrade = "again" | "hard" | "good" | "easy";
export type FinishGradeCounts = Record<FinishGrade, number>;

export const NO_FINISH_GRADES: FinishGradeCounts = { again: 0, hard: 0, good: 0, easy: 0 };

/** One answer given while studying. `card` is whatever the platform shows again. */
export type SittingAnswer<C> = {
  /** Identifies the answer, so undo can take it back. */
  id: string;
  /** The study screen it was given on. */
  session: string;
  key: string;
  deckId: string;
  deckName: string;
  grade: FinishGrade;
  isNew: boolean;
  ms: number;
  at: number;
  card: C;
};

export type SittingDeck = { id: string; name: string; cards: number; knew: number; ms: number };

export type SittingMiss<C> = { key: string; card: C; misses: number; lastGrade: FinishGrade };

export type SittingSummary<C> = {
  /** Different cards answered; a card that came back counts once. */
  cards: number;
  newCards: number;
  ms: number;
  /** Each card's first answer. */
  first: FinishGradeCounts;
  /** Cards whose first answer wasn't Again. */
  knew: number;
  misses: SittingMiss<C>[];
  decks: SittingDeck[];
};

/** Longest one answer counts for, so a phone left on the table isn't study time. */
const MAX_ANSWER_MS = 120_000;

export function summarizeAnswers<C>(answers: readonly SittingAnswer<C>[]): SittingSummary<C> {
  const first = { ...NO_FINISH_GRADES };
  const firstByKey = new Map<string, SittingAnswer<C>>();
  const misses = new Map<string, SittingMiss<C>>();
  const decks = new Map<string, SittingDeck>();
  let ms = 0;
  let newCards = 0;
  for (const answer of answers) {
    const spent = Math.min(Math.max(0, answer.ms), MAX_ANSWER_MS);
    ms += spent;
    const deck = decks.get(answer.deckId) ?? {
      id: answer.deckId,
      name: answer.deckName,
      cards: 0,
      knew: 0,
      ms: 0,
    };
    deck.ms += spent;
    decks.set(answer.deckId, deck);
    if (!firstByKey.has(answer.key)) {
      firstByKey.set(answer.key, answer);
      first[answer.grade] += 1;
      deck.cards += 1;
      if (answer.grade !== "again") deck.knew += 1;
      if (answer.isNew) newCards += 1;
    }
    const miss = misses.get(answer.key);
    if (answer.grade === "again") {
      misses.set(answer.key, {
        key: answer.key,
        card: answer.card,
        misses: (miss?.misses ?? 0) + 1,
        lastGrade: answer.grade,
      });
    } else if (miss) {
      misses.set(answer.key, { ...miss, card: answer.card, lastGrade: answer.grade });
    }
  }
  return {
    cards: firstByKey.size,
    newCards,
    ms,
    first,
    knew: firstByKey.size - first.again,
    misses: [...misses.values()],
    decks: [...decks.values()],
  };
}

/** Study with a gap longer than this starts a new sitting. */
const SITTING_GAP_MS = 30 * 60_000;

/**
 * The answers of the current sitting, kept while the student moves from one
 * deck's session to the next so the day's finish page can add them up. Holds
 * card text: clear it whenever the account changes.
 */
export function createSitting<C>() {
  let answers: SittingAnswer<C>[] = [];
  return {
    add(answer: SittingAnswer<C>) {
      const last = answers[answers.length - 1];
      if (last && answer.at - last.at > SITTING_GAP_MS) answers = [];
      answers = [...answers, answer];
    },
    remove(id: string) {
      answers = answers.filter((answer) => answer.id !== id);
    },
    updateCard(matches: (card: C) => boolean, update: (card: C) => C) {
      answers = answers.map((answer) =>
        matches(answer.card) ? { ...answer, card: update(answer.card) } : answer,
      );
    },
    all(): readonly SittingAnswer<C>[] {
      return answers;
    },
    session(session: string): readonly SittingAnswer<C>[] {
      return answers.filter((answer) => answer.session === session);
    },
    clear() {
      answers = [];
    },
  };
}

// ---------------------------------------------------------------------------
// What comes next

export type FinishExam = { id: string; name: string; ready: number };

export type FinishSession = {
  kind: "deck" | "exam" | "all";
  /** The deck or exam studied; absent for a session across decks. */
  id?: string;
  options: StudyQueueOptions;
};

export type FinishState =
  /** A short session stopped at its goal. */
  | "short"
  /** The session opened with nothing to study. */
  | "empty"
  /** New cards beyond the daily limit, or tomorrow's reviews early. */
  | "learned"
  | "ahead"
  | "exam"
  | "limit"
  | "returning"
  /** Every card in the deck has now been seen. */
  | "seen-all"
  /** This deck is done and something else is left today. */
  | "next"
  /** Nothing is left today. */
  | "done"
  /** What is left could not be loaded. */
  | "unknown";

/**
 * The answers whose misses the page's extras offer to look over. A deck
 * opened with nothing due lists them under "More from" that deck, so only
 * its own count; everywhere else it's the whole sitting.
 */
export function lookOverAnswers<C>(
  answers: readonly SittingAnswer<C>[],
  session: FinishSession,
  state: FinishState | undefined,
): readonly SittingAnswer<C>[] {
  if (state !== "empty" || session.kind !== "deck" || !session.id) return answers;
  return answers.filter((answer) => answer.deckId === session.id);
}

export type FinishNext =
  | { kind: "deck"; id: string; title: string; cards: number }
  | { kind: "exam"; id: string; title: string; cards: number }
  /** Everything left, across decks and exams. */
  | { kind: "all"; cards: number }
  /** The session itself, stopped short. */
  | { kind: "resume"; cards: number };

/** Something left to study today, in the order it is offered. */
export type FinishLeft =
  | { kind: "deck"; id: string; title: string; cards: number }
  | { kind: "exam"; id: string; title: string; cards: number };

/** Rows of what's left the page lists before folding the rest into one; fewer under the extras. */
export const FINISH_LEFT_ROWS = 4;

/** The rows to list, and how many more there are with how many cards. */
export function foldLeft(left: readonly FinishLeft[], limit = FINISH_LEFT_ROWS): {
  rows: FinishLeft[];
  more: { count: number; cards: number } | null;
} {
  // One over is listed: a fold of one would take the same room.
  if (left.length <= limit + 1) return { rows: [...left], more: null };
  const rest = left.slice(limit);
  return {
    rows: left.slice(0, limit),
    more: { count: rest.length, cards: rest.reduce((sum, entry) => sum + entry.cards, 0) },
  };
}

export type FinishExtras = {
  /** The deck to learn more new cards from, and how many it has. */
  learn: { deckId: string; title: string; waiting: number; newToday: number; newLimit: number } | null;
  /** Reviews due by tomorrow; `deckId` is null when they come from several decks. */
  ahead: { deckId: string | null; cards: number } | null;
};

export type FinishPlan = {
  state: FinishState;
  /** What the main button studies; null when the main button is Done. */
  next: FinishNext | null;
  left: FinishLeft[];
  /** Cards still being learned that come back later today, for the deck studied or the day. */
  returning: { deckId: string | null; cards: number; at: string } | null;
  held: { deckId: string; cards: number; limit: number | null } | null;
  extras: FinishExtras;
  /** Cards expected tomorrow: across decks, or in a deck opened with nothing due. Null if unknown. */
  tomorrow: number | null;
  deck: StudyFinishDeck | null;
};

export function finishPlan({
  session,
  reviewed,
  newLearned,
  remaining = 0,
  decks: allDecks,
  exams,
  now = Date.now(),
}: {
  session: FinishSession;
  /** Different cards answered in this session. */
  reviewed: number;
  /** How many of them were new. */
  newLearned: number;
  /** Cards left in a session that stopped at its goal. */
  remaining?: number;
  /** Null when they could not be loaded, so nothing is claimed about what's left. */
  decks: readonly StudyFinishDeck[] | null;
  exams: readonly FinishExam[];
  now?: number;
}): FinishPlan {
  const known = allDecks !== null;
  const decks = allDecks ?? [];
  const deck =
    session.kind === "deck" ? (decks.find((candidate) => candidate.id === session.id) ?? null) : null;
  const open = decks.filter((candidate) => !candidate.paused);

  // An exam comes first (it has a deadline), then decks with the most due.
  const left: FinishLeft[] = [
    ...exams
      .filter((exam) => exam.ready > 0 && !(session.kind === "exam" && exam.id === session.id))
      .map((exam) => ({ kind: "exam" as const, id: exam.id, title: exam.name, cards: exam.ready })),
    ...open
      .filter((candidate) => candidate.waiting > 0)
      .sort((a, b) => b.due - a.due || b.new - a.new)
      .map((candidate) => ({
        kind: "deck" as const,
        id: candidate.id,
        title: candidate.title,
        cards: candidate.waiting,
      })),
  ];
  // A deck session that ended early (its last card on the page was suspended,
  // say) goes on with its own deck first.
  if (deck && deck.waiting > 0) {
    const own = left.findIndex((entry) => entry.kind === "deck" && entry.id === deck.id);
    if (own > 0) left.unshift(...left.splice(own, 1));
    else if (own < 0) left.unshift({ kind: "deck", id: deck.id, title: deck.title, cards: deck.waiting });
  }

  let next: FinishNext | null = null;
  if (remaining > 0) {
    next = { kind: "resume", cards: remaining };
  } else if (session.kind === "exam") {
    // An exam's session leads on to the day's regular cards as one session.
    const regular = left.filter((entry) => entry.kind === "deck");
    const cards = regular.reduce((sum, entry) => sum + entry.cards, 0);
    const otherExam = left.find((entry) => entry.kind === "exam");
    next = otherExam ?? (regular.length === 1 ? regular[0]! : cards > 0 ? { kind: "all", cards } : null);
  } else {
    next = left[0] ?? null;
  }

  // Cards coming back and reviews held back belong to what was just studied.
  const scope = deck ? [deck] : session.kind === "all" ? open : [];
  const back = (left.length === 0 && reviewed > 0 ? open : scope)
    .filter((candidate) => candidate.returning > 0 && candidate.returning_at)
    .sort((a, b) => Date.parse(a.returning_at!) - Date.parse(b.returning_at!));
  const returning =
    back.length > 0
      ? {
          deckId: back.length === 1 ? back[0]!.id : null,
          cards: back.reduce((sum, candidate) => sum + candidate.returning, 0),
          at: back[0]!.returning_at!,
        }
      : null;
  const capped = scope
    .filter((candidate) => candidate.reviews_held_back > 0)
    .sort((a, b) => b.reviews_held_back - a.reviews_held_back)[0];
  const held = capped
    ? { deckId: capped.id, cards: capped.reviews_held_back, limit: capped.review_limit }
    : null;

  // More new cards from the deck just studied if it has any, else from the
  // deck holding the most back.
  const learnFrom =
    session.kind === "exam"
      ? null
      : deck && deck.new_held_back > 0
      ? deck
      : deck && reviewed === 0
        ? null
        : [...open]
            .filter((candidate) => candidate.new_held_back > 0)
            .sort((a, b) => b.new_held_back - a.new_held_back)[0];
  const aheadDecks = (
    session.kind === "exam" ? [] : deck && (reviewed === 0 || left.length > 0) ? [deck] : open
  ).filter(
    (candidate) => candidate.ahead > 0,
  );
  const extras: FinishExtras = {
    learn: learnFrom
      ? {
          deckId: learnFrom.id,
          title: learnFrom.title,
          waiting: learnFrom.new_held_back,
          newToday: learnFrom.new_today,
          newLimit: learnFrom.new_limit,
        }
      : null,
    ahead:
      aheadDecks.length > 0
        ? {
            deckId: aheadDecks.length === 1 ? aheadDecks[0]!.id : null,
            cards: aheadDecks.reduce((sum, candidate) => sum + candidate.ahead, 0),
          }
        : null,
  };

  const limitReached =
    held != null && deck != null && deck.review_limit != null && !session.options.allReviews;
  const seenAll =
    deck != null &&
    deck.total > 0 &&
    deck.unseen === 0 &&
    deck.new_held_back === 0 &&
    deck.waiting === 0 &&
    newLearned > 0;

  let state: FinishState;
  if (remaining > 0) state = "short";
  else if (reviewed === 0) state = "empty";
  else if (session.kind === "exam") state = "exam";
  else if (seenAll) state = "seen-all";
  else if (session.options.newLimit != null) state = "learned";
  else if (session.options.ahead) state = "ahead";
  else if (limitReached) state = "limit";
  else if (returning && deck?.returning && Date.parse(returning.at) - now <= SOON_MS) {
    state = "returning";
  }
  else if (!known) state = "unknown";
  else state = left.length > 0 ? "next" : "done";

  return {
    state,
    next,
    left,
    returning,
    held,
    extras,
    tomorrow: !known
      ? null
      : deck && reviewed === 0
        ? deck.tomorrow
        : open.reduce((sum, candidate) => sum + candidate.tomorrow, 0),
    deck,
  };
}

/** Cards back within this long are worth saying first; later ones are a note. */
const SOON_MS = 60 * 60_000;

/** The new-card limit that lets `count` more new cards through today. */
export function learnMoreLimit(
  learn: { newToday: number; newLimit: number },
  count: number,
): number {
  return Math.min(MAX_SESSION_NEW_LIMIT, Math.max(learn.newToday, learn.newLimit) + count);
}

/** How many new cards "learn more" offers: 5, 10 and 20, up to what is waiting. */
export function learnMoreChoices(waiting: number): number[] {
  const choices = [5, 10, 20].filter((count) => count < waiting);
  return waiting <= 20 ? [...choices, waiting] : choices;
}

// ---------------------------------------------------------------------------
// Words

const SECONDS_PER_CARD = 9;

export function cardCount(count: number): string {
  return `${count.toLocaleString("en-US")} card${count === 1 ? "" : "s"}`;
}

function minutesText(minutes: number, short: boolean): string {
  if (minutes < 60) return short ? `${minutes} min` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** How long cards should take: "4 min", or "4 minutes" in a sentence. */
export function finishEstimate(cards: number, short = true): string {
  return minutesText(Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60)), short);
}

/** Time spent, for a sentence: "7 minutes", "under a minute". */
export function finishDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "under a minute" : minutesText(minutes, false);
}

export type FinishCopy = { title: string; subtitle: string };

/** "at 3:42 PM"; pass the platform's own clock format. */
export type FormatTime = (iso: string) => string;

function tomorrowLine(cards: number | null): string {
  if (cards === null) return "";
  return cards > 0
    ? `Tomorrow has ${cardCount(cards)}, about ${finishEstimate(cards, false)}.`
    : "Nothing is due tomorrow.";
}

function returningLine(back: { cards: number; at: string }, formatTime: FormatTime): string {
  return `${cardCount(back.cards)} you're learning ${back.cards === 1 ? "comes" : "come"} back ${formatTime(back.at)}.`;
}

function didLine(summary: SittingSummary<unknown>): string {
  const spent = `${cardCount(summary.cards)} in ${finishDuration(summary.ms)}.`;
  if (summary.cards === 0) return "";
  if (summary.knew === 0) return spent;
  if (summary.knew === summary.cards) {
    return `${spent} You knew ${summary.cards === 1 ? "it" : "every one"} first time.`;
  }
  return `${spent} You knew ${summary.knew.toLocaleString("en-US")} of them first time.`;
}

/** The page's headline and the line under it. */
export function finishCopy({
  plan,
  session,
  summary,
  name,
  streak,
  formatTime,
  exam,
}: {
  plan: FinishPlan;
  session: FinishSession;
  /** This session's answers, or the whole sitting's once the day is done. */
  summary: SittingSummary<unknown>;
  /** The deck or exam studied. */
  name: string;
  streak?: number;
  formatTime: FormatTime;
  exam?: { daysLeft: number | null; nextAt: string | null } | null;
}): FinishCopy {
  const did = didLine(summary);
  switch (plan.state) {
    case "short":
      return {
        title: `That's ${cardCount(summary.cards)} done`,
        subtitle:
          plan.next && plan.next.cards > 0
            ? `${plan.next.cards.toLocaleString("en-US")} are left today, about ${finishEstimate(plan.next.cards, false)}.`
            : did,
      };
    case "empty":
      if (session.kind === "exam") {
        return {
          title: "Nothing to study yet",
          subtitle: exam?.nextAt
            ? `Your next pass is ${formatTime(exam.nextAt)}.`
            : "Nothing more is worth studying for this exam right now.",
        };
      }
      return {
        title: session.kind === "deck" && name ? `Nothing due in ${name}` : "Nothing due right now",
        subtitle: plan.returning
          ? returningLine(plan.returning, formatTime)
          : tomorrowLine(plan.tomorrow),
      };
    case "learned":
      return {
        title: `${summary.newCards.toLocaleString("en-US")} new card${summary.newCards === 1 ? "" : "s"} learned`,
        subtitle: plan.extras.learn
          ? `They come back over the next days. ${plan.extras.learn.waiting.toLocaleString("en-US")} more are waiting in ${plan.extras.learn.title}.`
          : "They come back over the next days.",
      };
    case "ahead":
      return {
        title: `${cardCount(summary.cards)} studied ahead`,
        subtitle: tomorrowLine(plan.tomorrow),
      };
    case "exam": {
      const when =
        exam?.daysLeft == null
          ? ""
          : exam.daysLeft <= 0
            ? `${name} is today.`
            : `${name} is ${exam.daysLeft === 1 ? "tomorrow" : `in ${exam.daysLeft} days`}.`;
      const nextPass = exam?.nextAt ? `Your next pass is ${formatTime(exam.nextAt)}.` : "";
      return {
        title: "Done for now",
        subtitle: [`${cardCount(summary.cards)} in ${finishDuration(summary.ms)}.`, when, nextPass]
          .filter(Boolean)
          .join(" "),
      };
    }
    case "limit": {
      const limit = plan.held?.limit ?? 0;
      return {
        title: `That's today's ${limit.toLocaleString("en-US")} reviews`,
        subtitle: plan.held?.cards === 1
            ? "1 more card is due. It comes first tomorrow, unless you do it now."
            : `${(plan.held?.cards ?? 0).toLocaleString("en-US")} more cards are due. They come first tomorrow, unless you do them now.`,
      };
    }
    case "returning": {
      const cards = plan.returning?.cards ?? 0;
      return {
        title: `${cardCount(cards)} ${cards === 1 ? "comes" : "come"} back ${plan.returning ? formatTime(plan.returning.at) : "soon"}`,
        subtitle: `${did} The rest of ${name || "today"} is done.`.trim(),
      };
    }
    case "seen-all":
      return {
        title: `You've seen every card in ${name}`,
        subtitle: `${did} From here it's only reviews${plan.deck && plan.deck.tomorrow > 0 ? `: ${plan.deck.tomorrow.toLocaleString("en-US")} tomorrow` : ""}.`,
      };
    case "next":
      return {
        title: session.kind === "deck" && name
          ? plan.deck && plan.deck.waiting > 0
            ? `That's ${cardCount(summary.cards)} done`
            : `${name} is done for ${plan.deck && plan.deck.returning > 0 ? "now" : "today"}`
          : `That's ${cardCount(summary.cards)} done`,
        subtitle: did,
      };
    case "unknown":
      return { title: `That's ${cardCount(summary.cards)} done`, subtitle: did };
    case "done": {
      const days = streak != null && streak > 1 ? `, and ${streak} days in a row` : "";
      return {
        title: plan.returning ? "Done for now" : "Done for today",
        subtitle: [
          `${cardCount(summary.cards)} in ${finishDuration(summary.ms)}${days}.`,
          plan.returning ? returningLine(plan.returning, formatTime) : "",
          tomorrowLine(plan.tomorrow),
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
  }
}

/** Why a missed card is worth another look. */
export function missNote(miss: { misses: number; lastGrade: FinishGrade }, lapses: number): string {
  const today = miss.misses === 1 ? "Missed once today" : `Missed ${miss.misses} times today`;
  const total = lapses + miss.misses;
  if (total >= 4) return `${today}, ${total} times in all. A shorter card may stick better.`;
  if (miss.lastGrade !== "again") return `${today}. Right when it came back.`;
  return `${today}.`;
}
