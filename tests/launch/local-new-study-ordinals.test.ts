import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  buildLocalStudySessionQueue,
  countLocalNewStudyCards,
  fetchLocalNewCandidates,
} from "../../packages/local-db/src/queries/study";

// Offline mirror of fetch_new_study_cards: new-card discovery is per
// (card, ordinal), so studying c1 / C1 leaves c2 / C2 in the new queue.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const table of APP_SCHEMA.tables)
    sqlite.exec(
      `CREATE TABLE "${table.name}" (id TEXT PRIMARY KEY,${table.columns.map((c) => `"${c.name}" ${c.type}`).join(",")})`,
    );
  const db: any = {
    async get(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).get(...params);
    },
    async getAll(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).all(...params);
    },
  };
  return { db, sqlite };
}

const occlusionData = JSON.stringify({
  imageUrl: "https://example.test/heart.png",
  rects: [
    { id: "a", x: 0.1, y: 0.1, width: 0.2, height: 0.2, ord: 1 },
    { id: "b", x: 0.5, y: 0.5, width: 0.2, height: 0.2, ord: 2 },
    { id: "c", x: 0.7, y: 0.1, width: 0.2, height: 0.2, ord: 3, enabled: false },
  ],
});

function seed(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO sources (id, project_id) VALUES ('src', 'deck');
    INSERT INTO generation_jobs (id, source_id) VALUES ('job', 'src');
  `);
  const card = sqlite.prepare(
    `INSERT INTO cards (id, job_id, type, cloze_text, occlusion_data, front, sort_order)
     VALUES (?, 'job', ?, ?, ?, ?, ?)`,
  );
  card.run("cloze", "cloze", "{{c1::Paris}} is the capital of {{C2::France}}", null, null, 1);
  card.run("io", "image-occlusion", null, occlusionData, '<img src="https://example.test/heart.png">', 2);
  card.run("basic", "basic", null, null, "Question", 3);
  card.run("suspended", "cloze", "{{c1::Suspended}} {{c2::note}}", null, null, 4);
  card.run("done", "cloze", "{{c1::Done}} {{c2::note}}", null, null, 5);
  card.run("broken-io", "image-occlusion", null, "not json", "x", 6);
  const review = sqlite.prepare(
    `INSERT INTO card_reviews (id, card_id, cloze_ord, due, state, reps, suspended)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?, ?, ?)`,
  );
  review.run("r1", "cloze", 1, 2, 1, 0); // c1 studied, c2 never seen
  review.run("r2", "io", 1, 2, 1, 0); // C1 studied, C2 never seen
  review.run("r3", "suspended", 0, 0, 0, 1); // suspended before being studied
  review.run("r4", "done", 1, 2, 1, 0);
  review.run("r5", "done", 2, 2, 1, 0);
}

describe("local new-card discovery", () => {
  it("keeps cards with unstudied ordinals and expands them per ordinal", async () => {
    const { db, sqlite } = database();
    try {
      seed(sqlite);
      const candidates = await fetchLocalNewCandidates(db, "deck", 50);
      expect(candidates.map((card) => card.id)).toEqual(["cloze", "io", "basic", "broken-io"]);
      expect(await countLocalNewStudyCards(db, "deck")).toBe(4);

      const session = await buildLocalStudySessionQueue(db, "deck", "2026-10-19T00:00:00.000Z", 20);
      expect(session.newItems.map((item) => item.queue_key)).toEqual([
        "cloze:c2",
        "io:c2",
        "basic",
        "broken-io",
      ]);
      expect(session.newTotal).toBe(4);
    } finally {
      sqlite.close();
    }
  });

  it("drops a card once every ordinal is studied or the card is suspended", async () => {
    const { db, sqlite } = database();
    try {
      seed(sqlite);
      sqlite.exec(`
        INSERT INTO card_reviews (id, card_id, cloze_ord, due, state, reps, suspended) VALUES
          ('r6', 'cloze', 2, '2099-01-01T00:00:00.000Z', 2, 1, 0),
          ('r7', 'io', 2, '2099-01-01T00:00:00.000Z', 2, 1, 0),
          ('r8', 'basic', 0, '2099-01-01T00:00:00.000Z', 0, 0, 1),
          ('r9', 'broken-io', 0, '2099-01-01T00:00:00.000Z', 2, 1, 0);
      `);
      expect(await fetchLocalNewCandidates(db, "deck", 50)).toEqual([]);
      expect(await countLocalNewStudyCards(db, "deck")).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
