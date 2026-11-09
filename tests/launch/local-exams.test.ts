import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  getLocalExamDetail,
  getLocalExamList,
  getLocalExamQueue,
} from "../../packages/local-db/src/queries/exams";
import { submitLocalReview } from "../../packages/local-db/src/queries/session";
import { memoryEngine } from "../../packages/scheduling/src/memory";

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
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const engine = memoryEngine();
const EXAM = "40000000-0000-4000-8000-000000000001";

async function seedDeck(db: any, deck: string) {
  await db.execute(
    `INSERT INTO projects (id, user_id, name, deck_name, settings) VALUES (?, 'user', ?, ?, '{}')`,
    [deck, deck, deck],
  );
  await db.execute(`INSERT INTO sources (id, user_id, project_id, type) VALUES (?, 'user', ?, 'text')`, [
    `${deck}-source`,
    deck,
  ]);
  await db.execute(`INSERT INTO generation_jobs (id, source_id) VALUES (?, ?)`, [
    `${deck}-job`,
    `${deck}-source`,
  ]);
}

async function seedCard(
  db: any,
  id: string,
  deck: string,
  extra: { type?: string; cloze_text?: string; tags?: string[]; sort_order?: number } = {},
) {
  await db.execute(
    `INSERT INTO cards (id, job_id, type, front, back, cloze_text, tags, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `${deck}-job`,
      extra.type ?? "basic",
      `Question ${id}`,
      `Answer ${id}`,
      extra.cloze_text ?? null,
      JSON.stringify(extra.tags ?? []),
      extra.sort_order ?? 0,
    ],
  );
}

/** A card failed on first sight two days ago and not seen since: well below any gate. */
async function seedFadedReview(db: any, cardId: string, extra: { suspended?: boolean } = {}) {
  const memory = engine.review(null, Date.now() - 2 * DAY, 1);
  await db.execute(
    `INSERT INTO card_reviews (id, card_id, user_id, cloze_ord, due, stability, stability_fast,
       difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review,
       learning_steps, suspended, version, fsrs_version)
     VALUES (?, ?, 'user', 0, ?, ?, ?, ?, 0, 1, 1, 0, 2, ?, 0, ?, 1, 7)`,
    [
      `${cardId}-review`,
      cardId,
      iso(-DAY),
      memory.stability,
      memory.stabilityFast,
      memory.difficulty,
      iso(-2 * DAY),
      extra.suspended ? 1 : 0,
    ],
  );
}

async function seedExam(
  db: any,
  overrides: {
    examAtOffsetMs?: number;
    selection?: Record<string, string[]>;
    cap?: number | null;
    archived?: boolean;
  } = {},
) {
  await db.execute(
    `INSERT INTO exams (id, user_id, name, exam_at, timezone, has_time, target_recall,
       daily_minutes_cap, selection_spec, study_windows, created_at, updated_at, archived_at)
     VALUES (?, 'user', 'Bio final', ?, 'UTC', 1, 0.9, ?, ?, '[]', ?, ?, ?)`,
    [
      EXAM,
      iso(overrides.examAtOffsetMs ?? 7 * DAY),
      overrides.cap ?? null,
      JSON.stringify(overrides.selection ?? { deck_ids: ["bio"] }),
      iso(0),
      iso(0),
      overrides.archived ? iso(0) : null,
    ],
  );
}

describe("exams from the local replica", () => {
  it("builds an exam's standing and queue from the cards' own memory", async () => {
    const { db, sqlite } = database();
    try {
      await seedDeck(db, "bio");
      await seedCard(db, "new-1", "bio", { sort_order: 1 });
      await seedCard(db, "new-2", "bio", { sort_order: 2 });
      await seedCard(db, "faded", "bio", { sort_order: 3 });
      await seedFadedReview(db, "faded");
      await seedExam(db);

      const { exams } = await getLocalExamList(db);
      expect(exams).toHaveLength(1);
      expect(exams[0]).toMatchObject({ id: EXAM, name: "Bio final", status: "active" });
      expect(exams[0]!.snapshot).toMatchObject({ total: 3, unseen: 2, at_risk: 1, stage: "learn" });
      expect(exams[0]!.ready_now).toBeGreaterThan(0);

      const queue = (await getLocalExamQueue(db, EXAM))!;
      const reasons = Object.fromEntries(queue.cards.map((card) => [card.id, card.reason]));
      expect(reasons.faded).toBe("strengthen");
      expect(reasons["new-1"]).toBe("new");
      expect(queue.cards.every((card) => card.deck_id === "bio" && card.deck_name === "bio")).toBe(true);
      expect(queue.cards.find((card) => card.id === "faded")).toMatchObject({
        front: "Question faded",
        is_new: false,
        state: 2,
      });
      expect(queue.cards.find((card) => card.id === "new-1")!.intervals.good).toBeTruthy();
      expect(queue.counts.new + queue.counts.due).toBe(queue.cards.length);

      const detail = (await getLocalExamDetail(db, EXAM))!;
      expect(detail.decks).toEqual([
        expect.objectContaining({ project_id: "bio", name: "bio", total: 3, unseen: 2, at_risk: 1 }),
      ]);
      expect(detail.plan.days.length).toBeGreaterThanOrEqual(7);
      expect(detail.plan.projected.recall_at_exam).toBeGreaterThan(detail.snapshot.recall_at_exam);
      expect(detail.plan.curve.map((point) => point.minutes_per_day)).toContain(null);
    } finally {
      sqlite.close();
    }
  });

  it("covers cards added to a deck after the exam was made, and leaves suspended cards out", async () => {
    const { db, sqlite } = database();
    try {
      await seedDeck(db, "bio");
      await seedCard(db, "first", "bio");
      await seedCard(db, "gone", "bio");
      await seedFadedReview(db, "gone", { suspended: true });
      // Six hours out, so no new card is held back for a later day.
      await seedExam(db, { examAtOffsetMs: 6 * HOUR });
      expect((await getLocalExamList(db)).exams[0]!.snapshot.total).toBe(1);

      await seedCard(db, "added-later", "bio");
      const queue = (await getLocalExamQueue(db, EXAM))!;
      expect(queue.cards.map((card) => card.id).sort()).toEqual(["added-later", "first"]);
    } finally {
      sqlite.close();
    }
  });

  it("narrows by tag within a deck and expands a cloze note into its ordinals", async () => {
    const { db, sqlite } = database();
    try {
      await seedDeck(db, "bio");
      await seedDeck(db, "chem");
      await seedCard(db, "tagged", "bio", { tags: ["week1"] });
      await seedCard(db, "untagged", "bio");
      await seedCard(db, "other-deck", "chem", { tags: ["week1"] });
      await seedCard(db, "cloze", "bio", {
        type: "cloze",
        cloze_text: "{{c1::Mitochondria}} make {{c2::ATP}}",
        tags: ["week1"],
      });
      await seedExam(db, {
        examAtOffsetMs: 6 * HOUR,
        selection: { deck_ids: ["bio"], tags: ["week1"] },
      });

      const queue = (await getLocalExamQueue(db, EXAM))!;
      expect(queue.cards.map((card) => card.queue_key).sort()).toEqual([
        "cloze:c1",
        "cloze:c2",
        "tagged",
      ]);
      expect(queue.cards.find((card) => card.queue_key === "cloze:c2")!.cloze_ord).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it("records exam study as an ordinary review of the real card", async () => {
    const { db, sqlite } = database();
    try {
      await seedDeck(db, "bio");
      await seedCard(db, "faded", "bio");
      await seedFadedReview(db, "faded");
      await seedExam(db);
      expect((await getLocalExamQueue(db, EXAM))!.cards.map((card) => card.id)).toEqual(["faded"]);

      await submitLocalReview(db, {
        userId: "user",
        cardId: "faded",
        grade: 3,
        context: "exam",
        examId: EXAM,
        responseMs: 4200,
      });

      // One memory: the card's own row moved, and the log says it was exam study.
      const review = await db.get("SELECT * FROM card_reviews WHERE card_id = 'faded'");
      expect(review.reps).toBe(2);
      expect(Date.parse(review.last_review)).toBeGreaterThan(Date.now() - 60_000);
      const log = await db.get("SELECT * FROM review_logs WHERE card_id = 'faded'");
      expect(log).toMatchObject({ context: "exam", exam_id: EXAM, response_ms: 4200, rating: 3 });

      // Studied today, so it is not pulled forward again before lock-in.
      const after = (await getLocalExamQueue(db, EXAM))!;
      expect(after.cards).toEqual([]);
      expect(after.exam.ready_now).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("holds the queue to the day's time cap and says what was left out", async () => {
    const { db, sqlite } = database();
    try {
      await seedDeck(db, "bio");
      for (let index = 0; index < 8; index++) await seedCard(db, `card-${index}`, "bio");
      // Six hours out: everything unseen is offered at once. One minute is three reviews.
      await seedExam(db, { examAtOffsetMs: 6 * HOUR, cap: 1 });
      const queue = (await getLocalExamQueue(db, EXAM))!;
      expect(queue.cards).toHaveLength(3);
      expect(queue.skipped).toBe(5);
    } finally {
      sqlite.close();
    }
  });

  it("offers nothing once the exam is over or archived", async () => {
    for (const overrides of [{ examAtOffsetMs: -HOUR }, { archived: true }]) {
      const { db, sqlite } = database();
      try {
        await seedDeck(db, "bio");
        await seedCard(db, "card", "bio");
        await seedExam(db, overrides);
        const queue = (await getLocalExamQueue(db, EXAM))!;
        expect(queue.cards).toEqual([]);
        expect(queue.exam.status).toBe(overrides.archived ? "archived" : "completed");
        expect(queue.exam.next_session_at).toBeNull();
      } finally {
        sqlite.close();
      }
    }
  });

  it("returns null for an exam that is not in the replica", async () => {
    const { db, sqlite } = database();
    try {
      expect(await getLocalExamDetail(db, "missing")).toBeNull();
      expect(await getLocalExamQueue(db, "missing")).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});
