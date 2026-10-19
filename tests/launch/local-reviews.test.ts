import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  buildScheduler,
  cardToRowFields,
  emptyCard,
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

it("Cram saves a complete snapshot and original clock time in its local transaction", async () => {
  const { db, sqlite } = database();
  try {
    const now = new Date("2026-01-01T12:00:00Z");
    const item = {
      ...cardToRowFields(emptyCard(now)),
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
    const candidate = Array.from({ length: 600 }, (_, i) => ({
      ...emptyCard(now),
      state: State.Review,
      stability: 10 + i / 100,
      difficulty: 5,
      reps: 10,
      scheduled_days: 10,
      last_review: new Date(now.getTime() - 10 * 86400000),
    })).find(
      (card) =>
        baseline.next(card, now, Rating.Good).card.due.getTime() !==
        adjusted.next(card, now, Rating.Good).card.due.getTime(),
    );
    expect(candidate).toBeDefined();
    if (!candidate)
      throw new Error("Expected a review that moves off a weekend");
    const expected = cardToRowFields(
      adjusted.next(candidate, now, Rating.Good).card,
    );
    const previous = cardToRowFields(candidate);
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
