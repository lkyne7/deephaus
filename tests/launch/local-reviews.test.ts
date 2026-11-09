import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  buildScheduler,
  newReviewFields,
  type CardReviewRow,
} from "../../packages/scheduling/src/fsrs";
import {
  gradeCramItemLocally,
  gradeCardLocally,
} from "../../packages/local-db/src/mutations/reviews";
import { weekendWarriorDays } from "../../packages/shared/src/easy-days";
import { State, Rating } from "../../packages/scheduling/src/index";
import {
  submitLocalReview,
  restoreLocalReviewState,
} from "../../packages/local-db/src/queries/session";
import { getLocalDeckSummaries } from "../../packages/local-db/src/queries/dashboard";
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const table of APP_SCHEMA.tables)
    sqlite.exec(
      `CREATE TABLE "${table.name}" (id TEXT PRIMARY KEY,${table.columns.map((c) => `"${c.name}" ${c.type}`).join(",")})`,
    );
  const db: any = {
    async execute(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).run(...params);
    },
    async getOptional(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async get(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).get(...params);
    },
    async getAll(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async writeTransaction(fn: (tx: any) => Promise<void>) {
      sqlite.exec("BEGIN");
      try {
        await fn(db);
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}
describe("local review durability", () => {
  it("persists complete snapshots and exact-event undo/redo", async () => {
    const { db, sqlite } = database();
    try {
      const result = await gradeCardLocally(db, {
        userId: "a",
        cardId: "card",
        clozeOrd: 0,
        rating: 3,
        review: null,
        desiredRetention: 0.9,
        now: new Date("2026-01-01T12:00:00Z"),
      });
      const row = await db.get("SELECT * FROM review_logs");
      expect(JSON.parse(row.next_state).due).toBe(result.next.due);
      // A review that says nothing else is ordinary, untimed study.
      expect(row).toMatchObject({ context: "study", exam_id: null, response_ms: null });
      await restoreLocalReviewState(db, {
        userId: "a",
        cardId: "card",
        clozeOrd: 0,
        logId: result.logId,
        logAction: "delete_latest",
        reviewState: null,
      });
      expect((await db.get("SELECT * FROM review_logs")).undone).toBe(1);
      expect(await db.getOptional("SELECT * FROM card_reviews")).toBeNull();
      await restoreLocalReviewState(db, {
        userId: "a",
        cardId: "card",
        clozeOrd: 0,
        logId: result.logId,
        logAction: "insert",
        reviewState: null,
      });
      expect((await db.get("SELECT * FROM card_reviews")).due).toBe(
        result.next.due,
      );
    } finally {
      sqlite.close();
    }
  });
  it("dashboard queries remain valid with retained undo history", async () => {
    const { db, sqlite } = database();
    try {
      expect(await getLocalDeckSummaries(db, new Date().toISOString())).toEqual(
        [],
      );
    } finally {
      sqlite.close();
    }
  });
});

describe("FSRS-7 on the local database", () => {
  const DAY = 86400000;
  const t0 = new Date("2026-03-02T15:00:00.000Z");
  const at = (days: number) => new Date(t0.getTime() + days * DAY);

  /** A card last graded by an app version that only knew FSRS-6. */
  async function seedFsrs6Card(db: any, cardId: string, firstLogState: number) {
    const review: CardReviewRow = {
      due: at(5).toISOString(),
      stability: 4.2,
      difficulty: 5.1,
      elapsed_days: 1,
      scheduled_days: 4,
      reps: 2,
      lapses: 0,
      state: State.Review,
      last_review: at(1).toISOString(),
      learning_steps: 0,
      stability_fast: null,
      fsrs_version: 6,
    };
    await db.execute(
      `INSERT INTO card_reviews(id,card_id,user_id,cloze_ord,version,${Object.keys(review).join(",")})
       VALUES(?,?,?,0,2,${Object.keys(review).map(() => "?").join(",")})`,
      [`review-${cardId}`, cardId, "a", ...Object.values(review)],
    );
    const { stability_fast: _fast, fsrs_version: _version, ...legacySnapshot } = review;
    const logs = [
      { id: `${cardId}-1`, rating: 3, state: firstLogState, review: at(0).toISOString() },
      { id: `${cardId}-2`, rating: 3, state: State.Learning, review: at(1).toISOString() },
    ];
    for (const log of logs)
      await db.execute(
        `INSERT INTO review_logs(id,card_id,user_id,cloze_ord,rating,state,review,undone,next_state) VALUES(?,?,?,0,?,?,?,0,?)`,
        // The latest review carries the snapshot it produced, as the old app wrote it.
        [log.id, cardId, "a", log.rating, log.state, log.review, log === logs[1] ? JSON.stringify(legacySnapshot) : null],
      );
    return { review, history: logs.map(({ rating, state, review: time }) => ({ rating, state, review: time })) };
  }

  it("stores both memory traces for a new card, in the row and in the review's snapshot", async () => {
    const { db, sqlite } = database();
    try {
      const result = await gradeCardLocally(db, {
        userId: "a",
        cardId: "fresh",
        clozeOrd: 0,
        rating: 3,
        review: null,
        now: t0,
      });
      const row = await db.get("SELECT * FROM card_reviews");
      expect(row.fsrs_version).toBe(7);
      expect(row.stability_fast).toBeGreaterThan(0);
      expect(row.stability_fast).toBe(result.next.stability_fast);
      const snapshot = JSON.parse((await db.get("SELECT next_state FROM review_logs")).next_state);
      expect(snapshot).toMatchObject({ fsrs_version: 7, stability_fast: row.stability_fast });
    } finally {
      sqlite.close();
    }
  });

  it("rebuilds an FSRS-6 card on FSRS-7 from its recorded reviews, and undo puts the FSRS-6 state back", async () => {
    const { db, sqlite } = database();
    try {
      const { review, history } = await seedFsrs6Card(db, "old", State.New);
      const result = await gradeCardLocally(db, {
        userId: "a",
        cardId: "old",
        clozeOrd: 0,
        rating: 3,
        review,
        now: at(5),
      });
      // Exactly what the scheduler derives from the card's own history.
      const expected = buildScheduler().grade({
        cardKey: "old:0",
        review,
        history,
        now: at(5),
        rating: Rating.Good,
      });
      expect(expected.model).toBe(7);
      expect(result.next).toEqual(expected.next);
      const row = await db.get("SELECT * FROM card_reviews");
      expect(row).toMatchObject({
        fsrs_version: 7,
        stability: expected.next.stability,
        stability_fast: expected.next.stability_fast,
        reps: 3,
        version: 3,
      });
      expect(row.stability_fast).toBeGreaterThan(0);

      await restoreLocalReviewState(db, {
        userId: "a",
        cardId: "old",
        clozeOrd: 0,
        logId: result.logId,
        logAction: "delete_latest",
        reviewState: null,
      });
      const restored = await db.get("SELECT * FROM card_reviews");
      expect(restored).toMatchObject({
        fsrs_version: 6,
        stability_fast: null,
        stability: review.stability,
        due: review.due,
        reps: 2,
      });
    } finally {
      sqlite.close();
    }
  });

  it("keeps a card on FSRS-6 when its first recorded review is missing", async () => {
    const { db, sqlite } = database();
    try {
      // History that starts mid-life: the card arrived with scheduling state but
      // without the reviews that produced it.
      const { review } = await seedFsrs6Card(db, "imported", State.Review);
      const result = await gradeCardLocally(db, {
        userId: "a",
        cardId: "imported",
        clozeOrd: 0,
        rating: 3,
        review,
        now: at(5),
      });
      expect(result.next.fsrs_version).toBe(6);
      expect(result.next.stability_fast).toBeNull();
      expect(result.next.scheduled_days % 1).toBe(0);
      const row = await db.get("SELECT fsrs_version, stability_fast FROM card_reviews");
      expect(row).toEqual({ fsrs_version: 6, stability_fast: null });
    } finally {
      sqlite.close();
    }
  });
});
it("records where a card was answered and how long it took, and keeps both through undo and redo", async () => {
  const { db, sqlite } = database();
  try {
    const examId = "40000000-0000-4000-8000-000000000001";
    const result = await submitLocalReview(db, {
      userId: "a",
      cardId: "card",
      grade: "good",
      now: new Date("2026-01-01T12:00:00Z"),
      context: "exam",
      examId,
      responseMs: 4200,
    });
    const recorded = { context: "exam", exam_id: examId, response_ms: 4200 };
    expect(await db.get("SELECT * FROM review_logs")).toMatchObject(recorded);
    for (const logAction of ["delete_latest", "insert"] as const)
      await restoreLocalReviewState(db, {
        userId: "a",
        cardId: "card",
        clozeOrd: 0,
        logId: result.review_id,
        logAction,
        reviewState: null,
      });
    expect(await db.get("SELECT * FROM review_logs")).toMatchObject({ ...recorded, undone: 0 });

    // Values the server would drop are not kept locally either.
    await gradeCardLocally(db, {
      userId: "a",
      cardId: "other",
      clozeOrd: 0,
      rating: 3,
      review: null,
      mutationId: "bad-values",
      context: "quiz" as never,
      examId: "not-a-uuid",
      responseMs: 3_600_001,
    });
    expect(await db.get("SELECT * FROM review_logs WHERE id='bad-values'")).toMatchObject({
      context: "study",
      exam_id: null,
      response_ms: null,
    });
  } finally {
    sqlite.close();
  }
});

it("Cram saves a complete snapshot and original clock time in its local transaction", async () => {
  const { db, sqlite } = database();
  try {
    const now = new Date("2026-01-01T12:00:00Z");
    const item = {
      ...newReviewFields(now),
      id: "item",
      plan_id: "plan",
      card_id: "card",
      project_id: "project",
      cloze_ord: 0,
      version: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    await db.execute("INSERT INTO cram_plan_items(id,version) VALUES(?,0)", [
      item.id,
    ]);
    const result = await gradeCramItemLocally(db, {
      userId: "a",
      item,
      rating: 3,
      targetRetention: 0.9,
      mutationId: "event",
      now,
      rawNow: new Date("2026-01-01T11:59:00Z"),
    });
    const log = await db.get("SELECT * FROM cram_review_logs");
    expect(log.id).toBe("event");
    expect(log.raw_review).toBe("2026-01-01T11:59:00.000Z");
    expect(JSON.parse(log.next_state).due).toBe(result.next.due);
    expect((await db.get("SELECT * FROM cram_plan_items")).version).toBe(1);
  } finally {
    sqlite.close();
  }
});

it("uses synced Easy Days preferences when submitting a local review", async () => {
  const { db, sqlite } = database();
  try {
    const now = new Date("2026-09-21T16:00:00Z");
    const easyDays = weekendWarriorDays();
    const baseline = buildScheduler({ requestRetention: 0.9 });
    const adjusted = buildScheduler({
      requestRetention: 0.9,
      easyDays,
      timezone: "UTC",
      dayStartHour: 4,
    });
    // Find a mature card whose normal next review would fall on a lighter day.
    const candidates = Array.from(
      { length: 600 },
      (_, i): CardReviewRow => ({
        due: now.toISOString(),
        state: State.Review,
        stability: 10 + i / 100,
        difficulty: 5,
        elapsed_days: 10,
        reps: 10,
        lapses: 0,
        learning_steps: 0,
        scheduled_days: 10,
        last_review: new Date(now.getTime() - 10 * 86400000).toISOString(),
      }),
    );
    const grade = (scheduler: typeof baseline, review: CardReviewRow) =>
      scheduler.grade({ cardKey: "card:0", review, now, rating: Rating.Good }).next;
    const previous = candidates.find(
      (review) => grade(baseline, review).due !== grade(adjusted, review).due,
    );
    expect(previous).toBeDefined();
    if (!previous)
      throw new Error("Expected a review that moves off a weekend");
    const expected = grade(adjusted, previous);
    await db.execute(
      "INSERT INTO user_study_settings(id,desired_retention,new_cards_per_day,day_start_hour,timezone,easy_days) VALUES(?,0.9,20,4,'UTC',?)",
      ["a", JSON.stringify(easyDays)],
    );
    const row = {
      id: "review",
      user_id: "a",
      card_id: "card",
      cloze_ord: 0,
      version: 0,
      ...previous,
    };
    await db.execute(
      `INSERT INTO card_reviews(${Object.keys(row).join(",")}) VALUES(${Object.keys(
        row,
      )
        .map(() => "?")
        .join(",")})`,
      Object.values(row),
    );
    const result = await submitLocalReview(db, {
      userId: "a",
      cardId: "card",
      grade: "good",
      now,
    });
    expect(result.due).toBe(expected.due);
    expect(result.scheduled_days).toBe(expected.scheduled_days);
    expect((await db.get("SELECT due FROM card_reviews")).due).toBe(
      expected.due,
    );
    const log = await db.get(
      "SELECT next_state,previous_state FROM review_logs",
    );
    expect(JSON.parse(log.next_state).due).toBe(expected.due);
    expect(JSON.parse(log.previous_state).due).toBe(previous.due);
  } finally {
    sqlite.close();
  }
});
