import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  getLocalActiveCramItems,
  getLocalCramPlanListPayload,
  getLocalCramQueuePayload,
  submitLocalCramReview,
} from "../../packages/local-db/src/queries/cram";

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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function seedPlan(
  db: any,
  overrides: { status?: string; deadlineOffsetMs?: number } = {},
) {
  await db.execute(
    `INSERT INTO cram_plans (id, user_id, name, status, deadline_at, deadline_timezone,
       deadline_has_time, target_retention, daily_minutes, selection_spec,
       estimated_seconds_per_review, created_at, updated_at)
     VALUES ('plan', 'user', 'Finals', ?, ?, 'UTC', 0, 0.9, 30, '{}', 20, ?, ?)`,
    [overrides.status ?? "active", iso(overrides.deadlineOffsetMs ?? 10 * DAY), iso(0), iso(0)],
  );
}

async function seedCard(db: any, cardId: string, suspended = false) {
  await db.execute(
    `INSERT INTO cards (id, type, front, back, tags) VALUES (?, 'basic', 'Q', 'A', '[]')`,
    [cardId],
  );
  if (suspended) {
    await db.execute(
      `INSERT INTO card_reviews (id, card_id, user_id, cloze_ord, suspended, state)
       VALUES (?, ?, 'user', 0, 1, 0)`,
      [`review-${cardId}`, cardId],
    );
  }
}

async function seedItem(
  db: any,
  id: string,
  cardId: string,
  fields: Partial<{
    state: number;
    stability: number;
    difficulty: number;
    reps: number;
    due: string;
    last_review: string | null;
  }> = {},
) {
  await db.execute(
    `INSERT INTO cram_plan_items (id, plan_id, card_id, project_id, cloze_ord, due,
       stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state,
       last_review, learning_steps, version, created_at, updated_at)
     VALUES (?, 'plan', ?, 'project', 0, ?, ?, ?, 0, 0, ?, 0, ?, ?, 0, 0, ?, ?)`,
    [
      id,
      cardId,
      fields.due ?? iso(0),
      fields.stability ?? 0,
      fields.difficulty ?? 0,
      fields.reps ?? 0,
      fields.state ?? 0,
      fields.last_review ?? null,
      iso(0),
      iso(0),
    ],
  );
}

describe("local cram queue", () => {
  it("skips suspended cards in the queue, counts and plan list", async () => {
    const { db, sqlite } = database();
    try {
      await seedPlan(db);
      await seedCard(db, "card-open");
      await seedCard(db, "card-suspended", true);
      await seedItem(db, "item-open", "card-open");
      await seedItem(db, "item-suspended", "card-suspended");

      expect((await getLocalActiveCramItems(db, "plan")).map((item) => item.id)).toEqual([
        "item-open",
      ]);
      const payload = await getLocalCramQueuePayload(db, "plan", { limit: 10 });
      expect(payload?.cards.map((card) => card.id)).toEqual(["card-open"]);
      expect(payload?.counts).toMatchObject({ total: 1, new: 1, remaining: 1 });

      const list = await getLocalCramPlanListPayload(db);
      expect(list.plans[0]).toMatchObject({ item_count: 1, card_count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it("closes an active plan once its deadline has passed", async () => {
    const { db, sqlite } = database();
    try {
      await seedPlan(db, { deadlineOffsetMs: -HOUR });
      await seedCard(db, "card");
      await seedItem(db, "item", "card");

      expect(await getLocalCramQueuePayload(db, "plan", { limit: 10 })).toBeNull();
      await expect(
        submitLocalCramReview(db, {
          userId: "user",
          planId: "plan",
          itemId: "item",
          rating: 3,
        }),
      ).rejects.toThrow(/deadline has passed/);
      const list = await getLocalCramPlanListPayload(db);
      expect(list.plans[0]).toMatchObject({ status: "completed" });
      expect(await db.get("SELECT status FROM cram_plans")).toMatchObject({
        status: "active",
      });
    } finally {
      sqlite.close();
    }
  });

  it("pulls a not-yet-due card forward at most once per day", async () => {
    const { db, sqlite } = database();
    try {
      await seedPlan(db);
      for (const id of ["card-today", "card-due", "card-yesterday"]) await seedCard(db, id);
      // Weak cards: all three would fall below the target by the deadline.
      const weak = { state: 2, stability: 2, difficulty: 8, reps: 2 };
      await seedItem(db, "item-today", "card-today", {
        ...weak,
        due: iso(2 * DAY),
        last_review: iso(-HOUR),
      });
      await seedItem(db, "item-due", "card-due", {
        ...weak,
        due: iso(-HOUR),
        last_review: iso(-2 * HOUR),
      });
      await seedItem(db, "item-yesterday", "card-yesterday", {
        ...weak,
        due: iso(2 * DAY),
        last_review: iso(-2 * DAY),
      });

      const payload = await getLocalCramQueuePayload(db, "plan", { limit: 10 });
      expect(payload?.cards.map((card) => card.id)).toEqual(["card-due", "card-yesterday"]);
    } finally {
      sqlite.close();
    }
  });
});
