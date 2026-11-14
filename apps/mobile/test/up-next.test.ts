import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import { describe, expect, it } from "vitest";
import type { BackgroundTask, RecentGenerationRun } from "../lib/background-tasks-context";
import { FRESH_WINDOW_MS, pickFreshRun, upNext } from "../lib/up-next";

const NOW = Date.parse("2026-11-12T15:20:00Z");

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    reviewed_today: 0,
    cards_learned_today: 0,
    retention_pct: 0.89,
    streak: 1,
    due_now: 174,
    new_today_remaining: 10,
    total_cards: 400,
    state_breakdown: { new: 25, learning: 0, review: 375, relearning: 0 },
    per_deck: [
      { deck_id: "psy", name: "Psych midterm", due: 174, new: 0, last_reviewed: null, total: 300 },
      { deck_id: "ch1", name: "Chapter 1", due: 0, new: 10, last_reviewed: null, total: 10, new_card_count: 10 },
    ],
    last_optimized_at: null,
    fsrs_log_count: 0,
    ...overrides,
  };
}

function run(overrides: Partial<RecentGenerationRun> = {}): RecentGenerationRun {
  return {
    taskId: "t1",
    jobId: "job1",
    cardsAdded: 15,
    sourceLabel: "“Photosynthesis”",
    finishedAt: NOW - 4 * 60 * 60 * 1000,
    badgesSeen: false,
    noticeDismissed: false,
    ...overrides,
  };
}

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task",
    kind: "generation",
    title: "Topic: Cell respiration",
    phase: "generating",
    status: "running",
    progress: 40,
    projectId: "cell",
    deckName: "Cell respiration",
    createdAt: NOW - 30_000,
    ...overrides,
  };
}

const withPhoto = stats({
  per_deck: [
    ...stats().per_deck,
    { deck_id: "bio", name: "Photosynthesis basics", due: 0, new: 15, last_reviewed: null, total: 15, new_card_count: 15 },
  ],
  new_today_remaining: 25,
});

function plan(overrides: Partial<Parameters<typeof upNext>[0]> = {}) {
  return upNext({
    stats: stats(),
    exams: [],
    projects: [],
    runs: {},
    tasks: [],
    deckNames: new Map(),
    now: NOW,
    ...overrides,
  });
}

describe("pickFreshRun", () => {
  it("offers a recent run whose deck still has unseen cards", () => {
    const fresh = pickFreshRun({ bio: run() }, withPhoto, new Map([["bio", "Photosynthesis basics"]]), NOW);
    expect(fresh).toMatchObject({ deckId: "bio", cards: 15, deckName: "Photosynthesis basics" });
  });

  it("counts only the run's cards the deck hasn't shown yet", () => {
    const base = withPhoto.per_deck.map((deck) => (deck.deck_id === "bio" ? { ...deck, new_card_count: 6 } : deck));
    expect(pickFreshRun({ bio: run() }, { ...withPhoto, per_deck: base }, new Map(), NOW)?.cards).toBe(6);
  });

  it("drops a run once learned, set aside, or old", () => {
    const learned = withPhoto.per_deck.map((deck) =>
      deck.deck_id === "bio" ? { ...deck, new: 0, new_card_count: 0 } : deck,
    );
    expect(pickFreshRun({ bio: run() }, { ...withPhoto, per_deck: learned }, new Map(), NOW)).toBeNull();
    expect(pickFreshRun({ bio: run({ noticeDismissed: true }) }, withPhoto, new Map(), NOW)).toBeNull();
    expect(
      pickFreshRun({ bio: run({ finishedAt: NOW - FRESH_WINDOW_MS - 1 }) }, withPhoto, new Map(), NOW),
    ).toBeNull();
  });

  it("picks the newest of several runs", () => {
    const fresh = pickFreshRun(
      { bio: run(), ch1: run({ jobId: "job2", cardsAdded: 10, finishedAt: NOW - 60_000 }) },
      withPhoto,
      new Map(),
      NOW,
    );
    expect(fresh?.deckId).toBe("ch1");
  });
});

describe("upNext", () => {
  it("leads with today's reviews, the new cards and the exam in the line under", () => {
    const exam = {
      id: "e1",
      name: "Psych midterm",
      status: "active",
      exam_at: "2026-11-17T09:00:00Z",
      ready_now: 134,
      ready_by_deck: [{ project_id: "psy", new: 0, due: 134, early: 0 }],
    } as unknown as ExamSummaryDto;
    const { card } = plan({ exams: [exam] });
    expect(card).toMatchObject({ kind: "study", title: "Review 174 cards", done: 0, total: 184, quick: true });
    if (card.kind !== "study") throw new Error("expected study");
    expect(card.detail).toContain("10 new");
    expect(card.detail).toContain("134 for Psych midterm");
  });

  it("offers cards just made before reviews, with today's cards as a row", () => {
    const result = plan({ stats: withPhoto, runs: { bio: run() } });
    expect(result.card.kind).toBe("fresh");
    expect(result.rows[0]).toMatchObject({ kind: "link", key: "today", title: "Today's cards" });
  });

  it("puts cards being made and failed runs first, finished ones only while handing over", () => {
    const making = task({ id: "a" });
    const failed = task({ id: "b", status: "failed", createdAt: NOW - 1000 });
    const done = task({ id: "c", status: "ready", progress: 100 });
    expect(plan({ tasks: [making, failed, done] }).rows.map((row) => row.key)).toEqual(["b", "a"]);
    expect(
      plan({ tasks: [making, done], finishing: new Set(["c"]) }).rows.map((row) => row.kind),
    ).toEqual(["making", "making"]);
  });

  it("says the day is done once nothing is left", () => {
    const done = stats({
      due_now: 0,
      new_today_remaining: 0,
      reviewed_today: 184,
      streak: 2,
      per_deck: [{ deck_id: "psy", name: "Psych", due: 0, new: 0, last_reviewed: null, total: 300 }],
    });
    expect(plan({ stats: done }).card).toEqual({
      kind: "done",
      title: "Done for today",
      detail: "184 cards today · 2-day streak",
    });
  });

  it("doesn't offer the short session when the day already fits in one", () => {
    const small = stats({
      due_now: 20,
      per_deck: [{ deck_id: "psy", name: "Psych", due: 20, new: 0, last_reviewed: null, total: 300 }],
      new_today_remaining: 0,
    });
    expect(plan({ stats: small }).card).toMatchObject({ kind: "study", quick: false });
  });
});

describe("pickFreshRun while a new deck syncs", () => {
  it("counts a just-finished run whose deck isn't in the numbers yet", () => {
    const justMade = run({ finishedAt: NOW - 60_000, cardsAdded: 12 });
    expect(
      pickFreshRun({ mito: justMade }, stats(), new Map([["mito", "Mitochondria structure"]]), NOW),
    ).toMatchObject({ deckId: "mito", cards: 12, deckName: "Mitochondria structure" });
  });

  it("stops counting it once that grace has passed", () => {
    expect(pickFreshRun({ mito: run({ finishedAt: NOW - 11 * 60_000 }) }, stats(), new Map(), NOW)).toBeNull();
  });
});

describe("pickFreshRun while its row is finishing", () => {
  it("leaves a run to its finished row until that row hands over", () => {
    expect(pickFreshRun({ bio: run({ taskId: "t9" }) }, withPhoto, new Map(), NOW, new Set(["t9"]))).toBeNull();
    expect(pickFreshRun({ bio: run({ taskId: "t9" }) }, withPhoto, new Map(), NOW, new Set())).not.toBeNull();
  });
});
