import { createRequire } from "node:module";
import type JSZipType from "jszip";
import { describe, it, expect } from "vitest";
import { ankiRevlogToFsrsLogs } from "../../packages/apkg/src/anki-revlog";
import { buildApkg } from "../../packages/apkg/src/builder";
import { parseApkgCollectionBytes } from "../../packages/apkg/src/importer";
import { getSql } from "../../packages/apkg/src/sql";

// jszip is a dependency of the apkg package, not of the workspace root.
const JSZip = createRequire(new URL("../../packages/apkg/package.json", import.meta.url))("jszip") as typeof JSZipType;

const DAY_MS = 86_400_000;
const now = new Date("2026-10-12T12:00:00.000Z");
const at = (daysAgo: number) => now.getTime() - daysAgo * DAY_MS;

describe("ankiRevlogToFsrsLogs", () => {
  it("orders grades oldest first and records the state before each one", () => {
    const logs = ankiRevlogToFsrsLogs(
      [
        { id: at(1), ease: 1, ivl: -600, lastIvl: 10, type: 1 },
        { id: at(20), ease: 3, ivl: 1, lastIvl: -60, type: 0 },
        { id: at(11), ease: 3, ivl: 10, lastIvl: 1, type: 1 },
        { id: at(0.5), ease: 3, ivl: 2, lastIvl: -600, type: 2 },
      ],
      now,
    );

    expect(logs.map((l) => l.rating)).toEqual([3, 3, 1, 3]);
    expect(logs.map((l) => l.state)).toEqual([0, 2, 2, 3]);
    expect(logs.map((l) => l.review)).toEqual(
      [20, 11, 1, 0.5].map((d) => new Date(at(d)).toISOString()),
    );
    expect(logs.map((l) => l.elapsed_days)).toEqual([0, 9, 10, 0]);
    expect(logs.map((l) => l.last_elapsed_days)).toEqual([0, 0, 9, 10]);
    expect(logs.map((l) => l.scheduled_days)).toEqual([60 / 86_400, 1, 10, 600 / 86_400]);
    // Due before each grade is the previous review plus the interval it set.
    expect(logs[2].due).toBe(new Date(at(11) + 10 * DAY_MS).toISOString());
    expect(logs[0].due).toBe(logs[0].review);
    expect(logs.every((l) => l.stability === 0 && l.difficulty === 0)).toBe(true);
  });

  it("skips manual reschedules and ungraded rows", () => {
    const logs = ankiRevlogToFsrsLogs(
      [
        { id: at(5), ease: 3, ivl: 4, lastIvl: 0, type: 0 },
        { id: at(3), ease: 0, ivl: 0, lastIvl: 4, type: 4 },
        { id: at(2), ease: 0, ivl: 7, lastIvl: 4, type: 5 },
      ],
      now,
    );
    expect(logs).toHaveLength(1);
  });

  it("maps a first non-learning grade and filtered-deck reviews to the right state", () => {
    const logs = ankiRevlogToFsrsLogs(
      [
        { id: at(9), ease: 4, ivl: 12, lastIvl: 5, type: 1 },
        { id: at(4), ease: 2, ivl: 6, lastIvl: 12, type: 3 },
        { id: at(2), ease: 3, ivl: -60, lastIvl: -60, type: 3 },
      ],
      now,
    );
    expect(logs.map((l) => l.state)).toEqual([2, 2, 1]);
  });

  it("never dates a review after the import", () => {
    const [log] = ankiRevlogToFsrsLogs([{ id: now.getTime() + 60_000, ease: 3, ivl: 1, lastIvl: 0, type: 0 }], now);
    expect(log.review).toBe(now.toISOString());
  });
});

async function fixtureCollection() {
  const generated = await buildApkg({
    deckName: "History fixture",
    cards: [
      { type: "basic", front: "Basic front", back: "Basic back", tags: [] },
      { type: "cloze", clozeText: "A {{c1::first}} and {{c2::second}}", extra: "", tags: [] },
    ],
  });
  const zip = await JSZip.loadAsync(generated.bytes);
  const SQL = await getSql();
  const db = new SQL.Database(await zip.file("collection.anki2")!.async("uint8array"));
  const crt = Math.floor(now.getTime() / 1000 / 86_400) * 86_400 - 100 * 86_400;
  db.run("update col set crt = ?", [crt]);

  const cards = db.exec("select cards.id, cards.ord, notes.flds from cards join notes on notes.id = cards.nid order by cards.id")[0]
    .values.map(([id, ord, flds]) => ({ id: Number(id), ord: Number(ord), basic: String(flds).startsWith("Basic") }));
  // revlog ids are review timestamps; offset by card id so they stay unique.
  const addReview = (cid: number, ease: number, type: number, ivl: number, lastIvl: number, daysAgo: number) => {
    db.run("insert into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) values (?, ?, -1, ?, ?, ?, 2500, 1000, ?)",
      [at(daysAgo) + (cid % 1000), cid, ease, ivl, lastIvl, type]);
  };

  for (const card of cards) {
    // Review card due in 5 days with a 10-day interval.
    db.run("update cards set type = 2, queue = 2, due = 105, ivl = 10, factor = 2500, reps = 3, lapses = 0 where id = ?", [card.id]);
    addReview(card.id, 3, 0, 1, -60, 20);
    addReview(card.id, 3, 1, 4, 1, 15);
    if (card.basic) {
      addReview(card.id, 0, 4, 0, 4, 12); // manual reschedule: no grade
      addReview(card.id, 3, 1, 10, 4, 6);
    } else if (card.ord === 1) {
      addReview(card.id, 1, 1, -600, 4, 3);
    }
  }

  const bytes = db.export();
  db.close();
  return { bytes, cards };
}

describe("parseApkgCollectionBytes review history", () => {
  it("attaches graded history to each review unit and anchors last_review on it", async () => {
    const { bytes } = await fixtureCollection();
    const parsed = await parseApkgCollectionBytes(bytes, { fsrsParamCount: 21 });
    const cards = parsed.decks.flatMap((d) => d.cards);
    const basic = cards.find((c) => c.type === "basic")!;
    const cloze = cards.find((c) => c.type === "cloze")!;

    expect(basic.history).toHaveLength(1);
    expect(basic.history[0].clozeOrd).toBe(0);
    expect(basic.history[0].logs).toHaveLength(3);
    expect(basic.reviews[0].fields.last_review).toBe(basic.history[0].logs[2].review);
    expect(basic.reviews[0].fields.elapsed_days).toBe(basic.history[0].logs[2].elapsed_days);

    expect(cloze.history.map((h) => [h.clozeOrd, h.logs.length])).toEqual([[1, 2], [2, 3]]);
    expect(parsed.stats.reviewLogCount).toBe(8);
  });

  it("reads no history when includeHistory is false", async () => {
    const { bytes } = await fixtureCollection();
    const parsed = await parseApkgCollectionBytes(bytes, { fsrsParamCount: 21, includeHistory: false });
    const cards = parsed.decks.flatMap((d) => d.cards);
    expect(cards.every((c) => c.history.length === 0)).toBe(true);
    expect(parsed.stats.reviewLogCount).toBe(0);
    expect(parsed.stats.scheduledCount).toBe(3);
  });
});
