import { createRequire } from "node:module";
import type JSZipType from "jszip";
import { describe, it, expect } from "vitest";
import type { ExportCardProgress } from "../../packages/apkg/src/anki-export-progress";
import { buildApkg } from "../../packages/apkg/src/builder";
import { parseApkg } from "../../packages/apkg/src/importer";
import { getSql } from "../../packages/apkg/src/sql";

// jszip is a dependency of the apkg package, not of the workspace root.
const JSZip = createRequire(new URL("../../packages/apkg/package.json", import.meta.url))("jszip") as typeof JSZipType;

const DAY_MS = 86_400_000;
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * DAY_MS).toISOString();

const cards = [
  { type: "basic" as const, front: "Review front", back: "Review back", tags: [] },
  { type: "basic" as const, front: "Untouched front", back: "Untouched back", tags: [] },
  { type: "cloze" as const, clozeText: "The {{c1::first}} and {{c2::second}}", extra: "", tags: [] },
  { type: "basic" as const, front: "Suspended new", back: "Back", tags: [] },
  { type: "basic" as const, front: "", back: "Skipped: no front", tags: [] },
  { type: "basic" as const, front: "Learning front", back: "Learning back", tags: [] },
];

const progress: Array<ExportCardProgress | undefined> = [
  {
    reviews: [{ clozeOrd: 0, due: iso(12), stability: 23.5, difficulty: 4.2, scheduledDays: 20, reps: 4, lapses: 1, state: 2, suspended: false }],
    logs: [
      { clozeOrd: 0, rating: 3, state: 0, scheduledDays: 0, review: iso(-40) },
      { clozeOrd: 0, rating: 3, state: 1, scheduledDays: 0, review: iso(-39) },
      { clozeOrd: 0, rating: 1, state: 2, scheduledDays: 10, review: iso(-29) },
      { clozeOrd: 0, rating: 3, state: 3, scheduledDays: 1, review: iso(-8) },
    ],
  },
  undefined,
  {
    reviews: [
      { clozeOrd: 1, due: iso(3), stability: 10, difficulty: 5, scheduledDays: 7, reps: 2, lapses: 0, state: 2, suspended: true },
      { clozeOrd: 2, due: iso(-2), stability: 2.5, difficulty: 6.1, scheduledDays: 1, reps: 3, lapses: 1, state: 3, suspended: false },
    ],
    logs: [
      { clozeOrd: 1, rating: 3, state: 0, scheduledDays: 0, review: iso(-10) },
      { clozeOrd: 2, rating: 3, state: 0, scheduledDays: 0, review: iso(-10) },
      { clozeOrd: 2, rating: 1, state: 2, scheduledDays: 4, review: iso(-3) },
    ],
  },
  {
    reviews: [{ clozeOrd: 0, due: iso(0), stability: 0, difficulty: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, suspended: true }],
    logs: [],
  },
  // A skipped card's progress must not shift later cards' progress.
  { reviews: [{ clozeOrd: 0, due: iso(1), stability: 1, difficulty: 5, scheduledDays: 1, reps: 1, lapses: 0, state: 2, suspended: false }], logs: [] },
  {
    reviews: [{ clozeOrd: 0, due: iso(10 / 1440), stability: 0.4, difficulty: 6, scheduledDays: 0, reps: 1, lapses: 0, state: 1, suspended: false }],
    logs: [{ clozeOrd: 0, rating: 3, state: 0, scheduledDays: 0, review: iso(-1 / 1440) }],
  },
];

async function exported() {
  const result = await buildApkg({ deckName: "Progress export", cards, progress });
  const parsed = await parseApkg(result.bytes, { fsrsParamCount: 21 });
  const byFront = new Map(parsed.decks.flatMap((d) => d.cards).map((c) => [c.front ?? c.clozeText, c]));
  return { result, parsed, byFront };
}

describe("buildApkg with progress", () => {
  it("round-trips schedules, suspension and FSRS memory through our importer", async () => {
    const { result, parsed, byFront } = await exported();
    expect(result.cardCount).toBe(5);
    expect(result.skipped).toBe(1);
    expect(result.scheduledExported).toBe(5);
    expect(result.suspendedExported).toBe(2);
    expect(parsed.stats.scheduledCount).toBe(5);
    expect(parsed.stats.suspendedCount).toBe(2);

    const review = byFront.get("Review front")!.reviews[0].fields;
    expect(review).toMatchObject({ state: 2, stability: 23.5, difficulty: 4.2, scheduled_days: 20, reps: 4, lapses: 1, suspended: false });
    expect(Math.abs(Date.parse(review.due) - Date.parse(progress[0]!.reviews[0].due))).toBeLessThan(DAY_MS);

    expect(byFront.get("Untouched front")!.reviews).toEqual([]);

    const cloze = byFront.get("The {{c1::first}} and {{c2::second}}")!;
    expect(cloze.reviews.map((r) => [r.clozeOrd, r.fields.state, r.fields.suspended])).toEqual([[1, 2, true], [2, 3, false]]);

    expect(byFront.get("Suspended new")!.reviews[0].fields).toMatchObject({ state: 0, suspended: true });

    const learning = byFront.get("Learning front")!.reviews[0].fields;
    expect(learning.state).toBe(1);
    expect(Math.abs(Date.parse(learning.due) - Date.parse(progress[5]!.reviews[0].due))).toBeLessThan(1000);
  });

  it("round-trips review history with grades and states in order", async () => {
    const { result, parsed, byFront } = await exported();
    expect(result.reviewLogsExported).toBe(8);
    expect(parsed.stats.reviewLogCount).toBe(8);

    const logs = byFront.get("Review front")!.history[0].logs;
    expect(logs.map((l) => [l.rating, l.state])).toEqual([[3, 0], [3, 1], [1, 2], [3, 3]]);
    expect(logs.map((l) => l.review)).toEqual(progress[0]!.logs.map((l) => new Date(Date.parse(l.review)).toISOString()));
    expect(logs[2].scheduled_days).toBe(10);

    const cloze = byFront.get("The {{c1::first}} and {{c2::second}}")!;
    expect(cloze.history.map((h) => [h.clozeOrd, h.logs.length])).toEqual([[1, 1], [2, 2]]);
  });

  it("writes Anki-valid queue, due and interval values", async () => {
    const { result } = await exported();
    const zip = await JSZip.loadAsync(result.bytes);
    const SQL = await getSql();
    const db = new SQL.Database(await zip.file("collection.anki2")!.async("uint8array"));
    const [crt] = db.exec("select crt from col")[0].values[0] as number[];
    const rows = db.exec("select n.flds, c.ord, c.type, c.queue, c.due, c.ivl, c.factor, c.data from cards c join notes n on n.id = c.nid order by c.id")[0]
      .values.map(([flds, ord, type, queue, due, ivl, factor, data]) => ({ front: String(flds).split("\u001f")[0], ord, type, queue, due, ivl, factor, data }));
    db.close();

    expect(crt % 86_400).toBe(0);
    const review = rows.find((r) => r.front === "Review front")!;
    expect(review).toMatchObject({ type: 2, queue: 2, ivl: 20, data: JSON.stringify({ s: 23.5, d: 4.2 }) });
    expect(Number(review.factor)).toBeGreaterThanOrEqual(1300);
    expect(rows.find((r) => r.front === "Untouched front")).toMatchObject({ type: 0, queue: 0, data: "" });
    expect(rows.find((r) => r.front.startsWith("The") && r.ord === 0)).toMatchObject({ type: 2, queue: -1 });
    expect(rows.find((r) => r.front.startsWith("The") && r.ord === 1)).toMatchObject({ type: 3, queue: 3, ivl: 1 });
    // Intraday learning keeps an epoch-second due on queue 1.
    const learning = rows.find((r) => r.front === "Learning front")!;
    expect(learning).toMatchObject({ type: 1, queue: 1, ivl: 0 });
    expect(Number(learning.due)).toBeGreaterThan(1_000_000_000);
  });

  it("leaves packages without progress unchanged", async () => {
    const result = await buildApkg({ deckName: "Plain", cards });
    expect(result.scheduledExported).toBe(0);
    expect(result.reviewLogsExported).toBe(0);
    const parsed = await parseApkg(result.bytes, { fsrsParamCount: 21 });
    expect(parsed.stats.scheduledCount).toBe(0);
  });
});
