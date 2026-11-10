import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import { describe, expect, it } from "vitest";
import {
  estimateMinutes,
  homeStudy,
  MAX_DECK_SEGMENTS,
  reviewBreakdown,
  welcomeLine,
} from "../lib/home-review";

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    reviewed_today: 0,
    cards_learned_today: 0,
    retention_pct: 0.89,
    streak: 12,
    due_now: 20,
    new_today_remaining: 39,
    total_cards: 300,
    state_breakdown: { new: 39, learning: 0, review: 261, relearning: 0 },
    per_deck: [
      { deck_id: "psy", name: "Intro to Psychology", due: 4, new: 0, last_reviewed: null, total: 50 },
      { deck_id: "bio", name: "Biology 101", due: 11, new: 39, last_reviewed: null, total: 95 },
      { deck_id: "done", name: "Finished", due: 0, new: 0, last_reviewed: null, total: 10 },
      { deck_id: "ch1", name: "Chapter 1", due: 5, new: 0, last_reviewed: null, total: 57 },
    ],
    last_optimized_at: null,
    fsrs_log_count: 0,
    ...overrides,
  };
}

describe("reviewBreakdown", () => {
  it("adds up what's ready and drops decks with nothing to study", () => {
    const result = reviewBreakdown(stats());
    expect(result.ready).toBe(59);
    expect(result.decks.map((deck) => deck.id)).toEqual(["bio", "ch1", "psy"]);
  });

  it("leaves a paused deck out of today's review", () => {
    const base = stats();
    const result = reviewBreakdown({
      ...base,
      per_deck: base.per_deck.map((deck) => (deck.deck_id === "bio" ? { ...deck, paused: true } : deck)),
    });
    expect(result.decks.map((deck) => deck.id)).toEqual(["ch1", "psy"]);
    expect(result.segments.some((segment) => segment.deckId === "bio")).toBe(false);
  });

  it("splits the due part of the bar by deck, between done and new", () => {
    const result = reviewBreakdown(stats({ reviewed_today: 7 }));
    expect(result.segments.map((segment) => segment.key)).toEqual([
      "done",
      "due-bio",
      "due-ch1",
      "due-psy",
      "new",
    ]);
  });

  it("merges decks past the limit into one slice", () => {
    const per_deck = Array.from({ length: MAX_DECK_SEGMENTS + 2 }, (_, index) => ({
      deck_id: `d${index}`,
      name: `Deck ${index}`,
      due: 10 - index,
      new: 0,
      last_reviewed: null,
      total: 20,
    }));
    const result = reviewBreakdown(stats({ per_deck, new_today_remaining: 0 }));
    const due = result.segments.filter((segment) => segment.kind === "due");
    expect(due).toHaveLength(MAX_DECK_SEGMENTS + 1);
    expect(due.at(-1)).toMatchObject({ key: "due-rest", deckId: null, value: 5 + 4 });
  });

  it("has no slices when nothing is ready", () => {
    const result = reviewBreakdown(
      stats({ due_now: 0, new_today_remaining: 0, per_deck: [] }),
    );
    expect(result.ready).toBe(0);
    expect(result.segments).toEqual([]);
  });
});

describe("estimateMinutes", () => {
  it("rounds to whole minutes, at least one", () => {
    expect(estimateMinutes(1)).toBe("1 min");
    expect(estimateMinutes(59)).toBe("9 min");
  });

  it("switches to hours for long sessions", () => {
    expect(estimateMinutes(400)).toBe("1 hr");
    expect(estimateMinutes(450)).toBe("1 hr 8 min");
  });
});

describe("homeStudy", () => {
  type Exam = Pick<ExamSummaryDto, "name" | "status" | "exam_at" | "ready_now" | "ready_by_deck">;
  const exam = (overrides: Partial<Exam> = {}): Exam => ({
    name: "Bio final",
    status: "active",
    exam_at: "2026-11-20T09:00:00.000Z",
    ready_now: 12,
    // Four of its cards are due in Biology anyway; eight it wants early.
    ready_by_deck: [{ project_id: "bio", new: 0, due: 4, early: 8 }],
    ...overrides,
  });
  const caughtUp = () =>
    stats({
      due_now: 0,
      new_today_remaining: 0,
      per_deck: [
        { deck_id: "bio", name: "Biology 101", due: 0, new: 0, last_reviewed: null, total: 95 },
      ],
    });

  it("is regular due and new on deck data alone", () => {
    expect(homeStudy(stats(), [])).toEqual({ ready: 59, hasWork: true, line: "About 9 min" });
  });

  it("adds only what an exam wants on top, and names the exam", () => {
    const result = homeStudy(stats(), [exam()]);
    // 20 due + 39 new + the 8 early cards; the 4 already due are not counted twice.
    expect(result.ready).toBe(67);
    expect(result.line).toBe("About 10 min · 12 for Bio final");
  });

  it("sums several exams into one short line", () => {
    const result = homeStudy(stats(), [
      exam(),
      exam({
        name: "Chem midterm",
        ready_now: 5,
        ready_by_deck: [{ project_id: "chem", new: 5, due: 0, early: 0 }],
      }),
    ]);
    expect(result.ready).toBe(72);
    expect(result.line).toBe("About 11 min · 17 for 2 exams");
  });

  it("still offers a session when only exam cards are ready", () => {
    const result = homeStudy(caughtUp(), [
      exam({ ready_now: 6, ready_by_deck: [{ project_id: "bio", new: 0, due: 0, early: 6 }] }),
    ]);
    expect(result).toEqual({ ready: 6, hasWork: true, line: "About 1 min · 6 for Bio final" });
  });

  it("counts an exam's ready cards even without a per-deck split", () => {
    expect(homeStudy(caughtUp(), [exam({ ready_now: 6, ready_by_deck: [] })]).ready).toBe(6);
  });

  it("ignores exams that are over or have nothing ready", () => {
    const result = homeStudy(stats(), [
      exam({ status: "completed" }),
      exam({ status: "archived" }),
      exam({ ready_now: 0, ready_by_deck: [] }),
    ]);
    expect(result).toEqual({ ready: 59, hasWork: true, line: "About 9 min" });
  });

  it("has no work once the decks are done and no exam is ready", () => {
    expect(homeStudy(caughtUp(), []).hasWork).toBe(false);
  });
});

describe("welcomeLine", () => {
  it("greets by time of day and name", () => {
    expect(welcomeLine(8, "Sam", false)).toBe("Good morning, Sam");
    expect(welcomeLine(14, "Sam", false)).toBe("Good afternoon, Sam");
    expect(welcomeLine(21, "Sam", false)).toBe("Good evening, Sam");
    expect(welcomeLine(2, "", false)).toBe("Good evening");
  });

  it("congratulates once everything is done", () => {
    expect(welcomeLine(21, "Sam", true)).toBe("Nice work, Sam");
  });
});
