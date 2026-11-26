import { describe, expect, it } from "vitest";
import {
  createSitting,
  finishCopy,
  finishPlan,
  foldLeft,
  learnMoreChoices,
  learnMoreLimit,
  lookOverAnswers,
  missNote,
  parseStudyQueueOptions,
  studyQueueQuery,
  summarizeAnswers,
  type FinishSession,
  type SittingAnswer,
  type StudyFinishDeck,
} from "../../packages/shared/src/study-finish";

const deck = (id: string, overrides: Partial<StudyFinishDeck> = {}): StudyFinishDeck => ({
  id,
  title: id,
  paused: false,
  due: 0,
  new: 0,
  waiting: 0,
  total: 100,
  unseen: 10,
  new_held_back: 0,
  new_today: 0,
  new_limit: 20,
  reviews_held_back: 0,
  review_limit: null,
  returning: 0,
  returning_at: null,
  ahead: 0,
  tomorrow: 0,
  ...overrides,
});
const session = (id = "a", options = {}): FinishSession => ({ kind: "deck", id, options });
const base = { reviewed: 10, newLearned: 0, exams: [] as never[] };
const formatTime = () => "at 3:42 PM";

function answer(id: string, key: string, grade: SittingAnswer<string>["grade"], at = 0): SittingAnswer<string> {
  return { id, session: "s1", key, deckId: "a", deckName: "A", grade, isNew: false, ms: 9000, at, card: key };
}

describe("lookOverAnswers", () => {
  const answers = [answer("1", "k1", "again"), { ...answer("2", "k2", "again"), deckId: "b" }];
  it("keeps to the deck when a deck opens with nothing due", () => {
    expect(lookOverAnswers(answers, session("a"), "empty").map((a) => a.key)).toEqual(["k1"]);
  });
  it("covers the whole sitting everywhere else", () => {
    expect(lookOverAnswers(answers, session("a"), "done")).toHaveLength(2);
    expect(lookOverAnswers(answers, { kind: "all", options: {} }, "empty")).toHaveLength(2);
  });
});

describe("summarizeAnswers", () => {
  it("counts a card once, by its first answer, and lists what was missed", () => {
    const summary = summarizeAnswers([
      answer("1", "k1", "again"),
      answer("2", "k2", "good"),
      answer("3", "k1", "again"),
      answer("4", "k1", "good"),
    ]);
    expect(summary).toMatchObject({ cards: 2, knew: 1, first: { again: 1, hard: 0, good: 1, easy: 0 } });
    expect(summary.misses).toEqual([{ key: "k1", card: "k1", misses: 2, lastGrade: "good" }]);
    expect(summary.ms).toBe(36_000);
  });

  it("doesn't count a phone left on the table as study time", () => {
    expect(summarizeAnswers([{ ...answer("1", "k", "good"), ms: 3_600_000 }]).ms).toBe(120_000);
  });
});

describe("createSitting", () => {
  it("takes answers back and starts again after a long gap", () => {
    const sitting = createSitting<string>();
    sitting.add(answer("1", "k1", "good", 0));
    sitting.add(answer("2", "k2", "good", 60_000));
    sitting.remove("2");
    expect(sitting.all().map((entry) => entry.id)).toEqual(["1"]);
    sitting.add(answer("3", "k3", "good", 60_000 * 40));
    expect(sitting.all().map((entry) => entry.id)).toEqual(["3"]);
  });
});

describe("finishPlan", () => {
  it("goes on to the deck with the most due, leaving out paused decks", () => {
    const plan = finishPlan({
      ...base,
      session: session(),
      decks: [
        deck("a"),
        deck("b", { new: 30, waiting: 30 }),
        deck("c", { due: 8, waiting: 8 }),
        deck("d", { due: 90, waiting: 90, paused: true }),
      ],
    });
    expect(plan.state).toBe("next");
    expect(plan.next).toEqual({ kind: "deck", id: "c", title: "c", cards: 8 });
    expect(plan.left.map((entry) => entry.kind === "deck" && entry.id)).toEqual(["c", "b"]);
  });

  it("puts an exam before other decks, and follows an exam with the day's cards", () => {
    const decks = [deck("b", { due: 8, waiting: 8 }), deck("c", { due: 4, waiting: 4 })];
    const exams = [{ id: "e", name: "Midterm", ready: 12 }];
    expect(finishPlan({ ...base, session: session(), decks, exams }).next).toMatchObject({ kind: "exam", id: "e" });
    const after = finishPlan({ ...base, session: { kind: "exam", id: "e", options: {} }, decks, exams });
    expect(after.state).toBe("exam");
    expect(after.next).toEqual({ kind: "all", cards: 12 });
  });

  it("offers no next when nothing is left, and the extras that have cards", () => {
    const plan = finishPlan({
      ...base,
      session: session(),
      decks: [deck("a", { new_held_back: 35, new_today: 20, ahead: 12, tomorrow: 14 }), deck("b", { ahead: 19, tomorrow: 19 })],
    });
    expect(plan).toMatchObject({ state: "done", next: null, tomorrow: 33 });
    expect(plan.extras.learn).toMatchObject({ deckId: "a", waiting: 35 });
    expect(plan.extras.ahead).toEqual({ deckId: null, cards: 31 });
  });

  it("keeps a deck opened with nothing due to that deck's extras", () => {
    const plan = finishPlan({
      ...base,
      reviewed: 0,
      session: session(),
      decks: [deck("a", { ahead: 12, tomorrow: 12 }), deck("b", { ahead: 5, new_held_back: 9, due: 3, waiting: 3 })],
    });
    expect(plan).toMatchObject({ state: "empty", tomorrow: 12 });
    expect(plan.extras).toEqual({ learn: null, ahead: { deckId: "a", cards: 12 } });
    expect(plan.next).toMatchObject({ id: "b" });
  });

  it("tells a reached limit from cards coming back, and drops the limit once passed", () => {
    const capped = deck("a", { reviews_held_back: 16, review_limit: 100 });
    expect(finishPlan({ ...base, session: session(), decks: [capped] })).toMatchObject({
      state: "limit",
      held: { deckId: "a", cards: 16, limit: 100 },
    });
    expect(finishPlan({ ...base, session: session("a", { allReviews: true }), decks: [capped] }).state).toBe("done");
    const back = deck("a", { returning: 2, returning_at: "2026-11-25T19:00:00.000Z" });
    const at = (iso: string) => finishPlan({ ...base, session: session(), decks: [back], now: Date.parse(iso) });
    expect(at("2026-11-25T18:30:00.000Z")).toMatchObject({
      state: "returning",
      returning: { deckId: "a", cards: 2 },
    });
    // Hours away: a note on a finished day, not the headline.
    expect(at("2026-11-25T12:00:00.000Z")).toMatchObject({ state: "done", returning: { cards: 2 } });
  });

  it("marks a deck seen through only when this session showed its last new card", () => {
    const seen = deck("a", { unseen: 0 });
    expect(finishPlan({ ...base, newLearned: 4, session: session(), decks: [seen] }).state).toBe("seen-all");
    expect(finishPlan({ ...base, newLearned: 0, session: session(), decks: [seen] }).state).toBe("done");
  });

  it("resumes a short session and a deck that stopped early", () => {
    expect(
      finishPlan({ ...base, remaining: 47, session: { kind: "all", options: {} }, decks: [] }),
    ).toMatchObject({ state: "short", next: { kind: "resume", cards: 47 } });
    expect(
      finishPlan({
        ...base,
        session: session(),
        decks: [deck("a", { due: 2, waiting: 2 }), deck("b", { due: 9, waiting: 9 })],
      }).next,
    ).toMatchObject({ kind: "deck", id: "a" });
  });

});

describe("foldLeft", () => {
  it("lists a handful and folds the rest into one row", () => {
    const left = Array.from({ length: 14 }, (_, i) => ({ kind: "deck" as const, id: `${i}`, title: `${i}`, cards: 2 }));
    expect(foldLeft(left)).toMatchObject({ rows: { length: 4 }, more: { count: 10, cards: 20 } });
    expect(foldLeft(left.slice(0, 5))).toMatchObject({ rows: { length: 5 }, more: null });
  });
});

describe("finish words", () => {
  const summary = summarizeAnswers([answer("1", "k1", "again"), answer("2", "k2", "good")]);
  const copy = (plan: ReturnType<typeof finishPlan>, who = session()) =>
    finishCopy({ plan, session: who, summary, name: "Biochemistry", streak: 12, formatTime });

  it("names the deck while more is left and the day once it isn't", () => {
    const next = finishPlan({ ...base, session: session(), decks: [deck("a"), deck("b", { due: 1, waiting: 1 })] });
    expect(copy(next).title).toBe("Biochemistry is done for today");
    const later = finishPlan({
      ...base,
      session: session(),
      decks: [deck("a", { returning: 1, returning_at: "2026-11-25T21:31:00.000Z" }), deck("b", { due: 1, waiting: 1 })],
      now: Date.parse("2026-11-25T18:30:00.000Z"),
    });
    expect(copy(later).title).toBe("Biochemistry is done for now");
    const done = finishPlan({ ...base, session: session(), decks: [deck("a", { tomorrow: 1 })] });
    expect(copy(done)).toEqual({
      title: "Done for today",
      subtitle: "2 cards in under a minute, and 12 days in a row. Tomorrow has 1 card, about 1 minute.",
    });
  });

  it("says what was known first time without a zero", () => {
    const next = finishPlan({ ...base, session: session(), decks: [deck("a"), deck("b", { due: 1, waiting: 1 })] });
    const said = (answers: SittingAnswer<string>[]) =>
      finishCopy({ plan: next, session: session(), summary: summarizeAnswers(answers), name: "Biochemistry", streak: null, formatTime }).subtitle;
    expect(said([answer("1", "k1", "again"), answer("1", "k1", "good")])).toBe("1 card in under a minute.");
    expect(said([answer("1", "k1", "good")])).toBe("1 card in under a minute. You knew it first time.");
    expect(said([answer("1", "k1", "good"), answer("2", "k2", "easy")])).toBe("2 cards in under a minute. You knew every one first time.");
    expect(said([answer("1", "k1", "again"), answer("2", "k2", "easy")])).toBe("2 cards in under a minute. You knew 1 of them first time.");
  });

  it("uses the singular for one card", () => {
    const plan = finishPlan({
      ...base,
      session: session(),
      decks: [deck("a", { returning: 1, returning_at: "2026-11-25T19:00:00.000Z" })],
      now: Date.parse("2026-11-25T18:30:00.000Z"),
    });
    expect(copy(plan).title).toBe("1 card comes back at 3:42 PM");
  });

  it("still works when the summary could not be loaded", () => {
    const plan = finishPlan({ ...base, session: session(), decks: null });
    expect(plan).toMatchObject({ state: "unknown", next: null, deck: null, tomorrow: null });
    expect(copy(plan)).toMatchObject({ title: "That's 2 cards done" });
  });

  it("describes a miss", () => {
    expect(missNote({ misses: 1, lastGrade: "good" }, 0)).toBe("Missed once today. Right when it came back.");
    expect(missNote({ misses: 2, lastGrade: "good" }, 4)).toBe(
      "Missed 2 times today, 6 times in all. A shorter card may stick better.",
    );
  });
});

describe("queue options", () => {
  it("round-trips through a URL", () => {
    const options = { newLimit: 30, allReviews: true, ahead: true, learning: true };
    const search = new URLSearchParams(studyQueueQuery(options));
    expect(parseStudyQueueOptions((key) => search.get(key))).toEqual(options);
    expect(studyQueueQuery({})).toBe("");
    expect(parseStudyQueueOptions(() => null)).toEqual({});
    expect(parseStudyQueueOptions((key) => (key === "newLimit" ? "-4" : null))).toEqual({});
  });

  it("offers up to what is waiting", () => {
    expect(learnMoreChoices(35)).toEqual([5, 10, 20]);
    expect(learnMoreChoices(12)).toEqual([5, 10, 12]);
    expect(learnMoreChoices(3)).toEqual([3]);
    expect(learnMoreLimit({ newToday: 20, newLimit: 20 }, 10)).toBe(30);
    expect(learnMoreLimit({ newToday: 35, newLimit: 20 }, 5)).toBe(40);
  });
});
