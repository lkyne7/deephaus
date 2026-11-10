import type { ExamSummaryDto, ReviewCardPayload } from "@deephaus/api-client";
import { chainStudyQueues, sumQueueCounts, type ChainedPage } from "@deephaus/shared";
import { describe, expect, it } from "vitest";
import {
  NO_SESSION_COUNTS,
  dropStaleCards,
  pageCounts,
  pendingCardKeys,
  readyExams,
  readyOnPage,
  seedSessionCounts,
  sessionCards,
  studySources,
  type SessionPage,
} from "@/lib/study/session";

type Exam = Pick<ExamSummaryDto, "id" | "name" | "status" | "exam_at" | "ready_now" | "ready_by_deck">;

function exam(overrides: Partial<Exam> & { id: string }): Exam {
  return {
    name: overrides.id,
    status: "active",
    exam_at: "2026-12-01T09:00:00.000Z",
    ready_now: 0,
    ready_by_deck: [],
    ...overrides,
  };
}

const deck = (id: string, due: number, fresh: number) => ({
  id,
  due,
  new: fresh,
  waiting: due + fresh,
});

function card(key: string, overrides: Partial<ReviewCardPayload> = {}): ReviewCardPayload {
  return {
    id: key,
    queue_key: key,
    cloze_ord: null,
    type: "basic",
    front: "Q",
    back: "A",
    cloze_text: null,
    extra: null,
    tags: [],
    state: 2,
    due: "2026-11-09T00:00:00.000Z",
    reps: 3,
    lapses: 0,
    is_new: false,
    intervals: { again: "1m", hard: "1d", good: "3d", easy: "7d" },
    ...overrides,
  };
}

function deckPage(id: string, name: string, cards: ReviewCardPayload[]): SessionPage {
  return {
    deck: { id, name },
    cards,
    counts: { due: cards.length, new: 0, learning: 0, total: cards.length },
    dropped: 0,
  };
}

function examPage(id: string, name: string, cards: ReviewCardPayload[]): SessionPage {
  return {
    deck: { id, name },
    cards: cards.map((c) => ({
      ...c,
      deck_id: "bio",
      deck_name: "Science::Biology",
      reason: "strengthen" as const,
    })),
    counts: { due: cards.length, new: 0, learning: 0, total: cards.length },
    day_start_hour: 4,
    learn_ahead: false,
    exam: { id, name } as ExamSummaryDto,
    skipped: 0,
    next_ready_at: null,
    dropped: 0,
  };
}

describe("readyExams", () => {
  it("keeps active exams with cards ready, soonest exam first", () => {
    const result = readyExams([
      exam({ id: "later", ready_now: 4, exam_at: "2026-12-20T09:00:00.000Z" }),
      exam({ id: "nothing-ready", ready_now: 0, exam_at: "2026-11-10T09:00:00.000Z" }),
      exam({ id: "sooner", ready_now: 9, exam_at: "2026-11-15T09:00:00.000Z" }),
      exam({ id: "over", ready_now: 5, status: "completed" }),
      exam({ id: "shelved", ready_now: 5, status: "archived" }),
    ]);
    expect(result.map((e) => e.id)).toEqual(["sooner", "later"]);
  });
});

describe("studySources", () => {
  it("puts exams first, then decks with work today, due work first", () => {
    const sources = studySources(
      [
        exam({ id: "chem-final", ready_now: 3, exam_at: "2026-12-20T09:00:00.000Z" }),
        exam({ id: "bio-final", ready_now: 12, exam_at: "2026-11-15T09:00:00.000Z" }),
      ],
      [deck("new-only", 0, 10), deck("caught-up", 0, 0), deck("some-due", 4, 0), deck("most-due", 11, 2)],
    );
    expect(sources).toEqual([
      { id: "bio-final", kind: "exam" },
      { id: "chem-final", kind: "exam" },
      { id: "most-due", kind: "deck" },
      { id: "some-due", kind: "deck" },
      { id: "new-only", kind: "deck" },
    ]);
  });

  it("is just the decks when no exam has cards ready", () => {
    expect(studySources([exam({ id: "quiet" })], [deck("bio", 2, 0)])).toEqual([
      { id: "bio", kind: "deck" },
    ]);
  });
});

describe("seedSessionCounts", () => {
  it("takes the exam's share off the deck so no card is counted twice", () => {
    const counts = seedSessionCounts(
      [
        exam({
          id: "bio-final",
          ready_now: 15,
          ready_by_deck: [{ project_id: "bio", new: 5, due: 8, early: 2 }],
        }),
      ],
      [deck("bio", 12, 10), deck("psy", 4, 0)],
    );
    // The exam shows its 8 due and 2 early cards as due, and its 5 new ones.
    expect(counts["bio-final"]).toEqual({ due: 10, learning: 0, new: 5 });
    // Biology keeps only what the exam's session will not already have done.
    expect(counts.bio).toEqual({ due: 4, learning: 0, new: 5 });
    expect(counts.psy).toEqual({ due: 4, learning: 0, new: 0 });
    // Regular due (16) + regular new (10) + the 2 cards the exam wants early.
    const total = sumQueueCounts(counts, NO_SESSION_COUNTS);
    expect(total.due + total.new).toBe(28);
  });

  it("never goes below zero when exams want more than the deck offers", () => {
    const counts = seedSessionCounts(
      [
        exam({
          id: "a",
          ready_now: 30,
          ready_by_deck: [{ project_id: "bio", new: 30, due: 0, early: 0 }],
        }),
      ],
      [deck("bio", 3, 10)],
    );
    expect(counts.a).toEqual({ due: 0, learning: 0, new: 30 });
    expect(counts.bio).toEqual({ due: 3, learning: 0, new: 0 });
  });

  it("falls back to the exam's ready count when there is no per-deck split", () => {
    const counts = seedSessionCounts([exam({ id: "a", ready_now: 7 })], []);
    expect(counts.a).toEqual({ due: 7, learning: 0, new: 0 });
  });

  it("leaves out exams with nothing ready and decks with nothing waiting", () => {
    const counts = seedSessionCounts(
      [exam({ id: "quiet" }), exam({ id: "over", ready_now: 4, status: "completed" })],
      [deck("bio", 2, 1), deck("done", 0, 0)],
    );
    expect(Object.keys(counts)).toEqual(["bio"]);
  });
});

describe("pageCounts", () => {
  it("prefers today's remaining new cards over the deck-wide total", () => {
    expect(pageCounts({ due: 5, learning: 2, new: 80, new_today_remaining: 10 })).toEqual({
      due: 5,
      learning: 2,
      new: 10,
    });
    // An exam's queue has no daily supply to prefer.
    expect(pageCounts({ due: 5, learning: 2, new: 8 })).toEqual({ due: 5, learning: 2, new: 8 });
  });
});

describe("dropStaleCards", () => {
  it("leaves out an answered card a page still shows at its old review count", () => {
    const answered = new Map([
      ["stale", 3],
      ["returned", 3],
    ]);
    const kept = dropStaleCards(
      [card("stale", { reps: 3 }), card("returned", { reps: 4 }), card("unseen", { reps: 0 })],
      answered,
    );
    expect(kept.map((c) => c.queue_key)).toEqual(["returned", "unseen"]);
  });
});

describe("pendingCardKeys", () => {
  it("covers cards still to be shown and grades still saving, not ones already done", () => {
    const queue = [card("done"), card("on-screen"), card("next")];
    const keys = pendingCardKeys(queue, 1, new Set(["saving"]));
    expect([...keys].sort()).toEqual(["next", "on-screen", "saving"]);
  });
});

describe("sessionCards", () => {
  it("tags a deck's cards with the deck as their source and plain study", () => {
    const [first] = sessionCards({ deckId: "bio", queue: deckPage("bio", "Biology", [card("c1")]) });
    expect(first).toMatchObject({ queue_key: "c1", source_id: "bio", deck_name: "Biology" });
    expect(first.exam_id).toBeUndefined();
  });

  it("tags an exam's cards with the exam, keeping each card's own deck and reason", () => {
    const [first] = sessionCards({
      deckId: "bio-final",
      queue: examPage("bio-final", "Bio final", [card("c1")]),
    });
    expect(first).toMatchObject({
      source_id: "bio-final",
      exam_id: "bio-final",
      exam_name: "Bio final",
      deck_name: "Science::Biology",
      reason: "strengthen",
    });
  });
});

describe("readyOnPage", () => {
  it("counts what is ready beyond the page that was sent", () => {
    expect(readyOnPage({ cards: [1, 2], dropped: 0, counts: { due: 60, new: 20 } })).toBe(80);
    expect(readyOnPage({ cards: [1, 2], dropped: 0, counts: { due: 0, new: 0 } })).toBe(2);
  });

  it("takes off cards left out as stale", () => {
    expect(readyOnPage({ cards: [1], dropped: 2, counts: { due: 10, new: 0 } })).toBe(8);
    expect(readyOnPage({ cards: [], dropped: 2, counts: { due: 2, new: 0 } })).toBe(0);
  });
});

describe("the combined session's chain", () => {
  it("studies the exam first, then the deck, without showing a card twice", async () => {
    // Biology's own queue offers the two cards the exam wants, plus one more.
    const pages: Record<string, () => SessionPage> = {
      "bio-final": () => examPage("bio-final", "Bio final", [card("c1"), card("c2")]),
      bio: () => deckPage("bio", "Biology", [card("c1"), card("c2"), card("c3")]),
    };
    const sources = studySources(
      [exam({ id: "bio-final", ready_now: 2 })],
      [deck("bio", 3, 0)],
    );
    const chain = chainStudyQueues<ReviewCardPayload, SessionPage>(
      sources.map((source) => source.id),
      async (id) => pages[id](),
    );

    const first = (await chain.next(new Set())) as ChainedPage<SessionPage>;
    const queue = sessionCards(first);
    expect(queue.map((c) => [c.queue_key, c.exam_id])).toEqual([
      ["c1", "bio-final"],
      ["c2", "bio-final"],
    ]);

    // c1 is answered and saved; c2 is still on screen when the next page is asked for.
    pages["bio-final"] = () => examPage("bio-final", "Bio final", [card("c2")]);
    pages.bio = () => deckPage("bio", "Biology", [card("c2"), card("c3")]);
    const next = (await chain.next(pendingCardKeys(queue, 1, []))) as ChainedPage<SessionPage>;
    expect(next.deckId).toBe("bio");
    expect(sessionCards(next).map((c) => [c.queue_key, c.exam_id])).toEqual([["c3", undefined]]);
  });
});
