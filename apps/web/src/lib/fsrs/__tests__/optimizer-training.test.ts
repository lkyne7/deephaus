import { describe, expect, it } from "vitest";
import {
  computeParameters,
  convertCsvToFsrsItemsWithCardIds,
} from "@open-spaced-repetition/binding";
import {
  FSRS7_PARAM_COUNT,
  Rating,
  buildScheduler,
  parseStoredWeights,
  type CardReviewRow,
  type FsrsGrade,
  type ReviewHistoryEntry,
} from "@/lib/fsrs/scheduler";
import {
  buildFsrs7TrainingCsv,
  countUsableTrainingItems,
  type TrainingLogRow,
} from "@/lib/fsrs/training-items";

/** Review logs as the app records them, from simulated study of `cards` cards. */
function simulatedLogs(cards: number): TrainingLogRow[] {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const scheduler = buildScheduler({ enableFuzz: false });
  const start = Date.UTC(2026, 0, 5, 14);
  const logs: TrainingLogRow[] = [];
  for (let card = 0; card < cards; card++) {
    let review: CardReviewRow | null = null;
    let now = new Date(start + card * 3_600_000 + Math.floor(random() * 60_000));
    const history: ReviewHistoryEntry[] = [];
    const reviews = 3 + Math.floor(random() * 8);
    for (let i = 0; i < reviews; i++) {
      const recall = review ? scheduler.retrievability(review, now) : 0.7;
      const roll = random();
      const rating: FsrsGrade =
        roll > recall ? Rating.Again : roll < 0.1 ? Rating.Hard : roll < 0.85 ? Rating.Good : Rating.Easy;
      const result = scheduler.grade({ cardKey: `c${card}:0`, review, history, now, rating });
      history.push({ rating, state: result.log.state, review: result.log.review });
      logs.push({
        card_id: `c${card}`,
        cloze_ord: 0,
        rating,
        state: result.log.state,
        review: result.log.review,
      });
      review = result.next;
      // Answer a little after the card comes due.
      const interval = Date.parse(review.due) - now.getTime();
      now = new Date(Date.parse(review.due) + 1000 + Math.floor(random() * 0.2 * interval));
    }
  }
  return logs.sort((a, b) => Date.parse(a.review) - Date.parse(b.review));
}

describe("FSRS-7 optimizer pipeline", () => {
  it("trains on exactly the reviews the readiness meter counts, and yields weights the scheduler accepts", async () => {
    const logs = simulatedLogs(120);
    const dataset = convertCsvToFsrsItemsWithCardIds(
      buildFsrs7TrainingCsv(logs),
      4,
      "America/Toronto",
      "FSRS-7",
    );
    expect(dataset.items.length).toBeGreaterThan(300);
    expect(dataset.items.length).toBe(countUsableTrainingItems(logs));

    const fitted = Array.from(
      await computeParameters(dataset.items, {
        modelVersion: "FSRS-7",
        enableShortTerm: true,
        cardIds: dataset.cardIds,
        timeout: 50,
      }),
    );
    expect(fitted).toHaveLength(FSRS7_PARAM_COUNT);
    expect(fitted.every(Number.isFinite)).toBe(true);
    // Stored and read back, they are recognised as FSRS-7 weights…
    const weights = parseStoredWeights(JSON.parse(JSON.stringify(fitted)));
    expect(weights.fsrs7).toEqual(fitted);

    // …and they change scheduling rather than being rejected for the defaults.
    const input = { cardKey: "probe:0", review: null, now: new Date("2026-06-01T12:00:00Z"), rating: Rating.Good };
    const personal = buildScheduler({ weights, enableFuzz: false }).grade(input);
    const standard = buildScheduler({ enableFuzz: false }).grade(input);
    expect(personal.model).toBe(7);
    expect(Number.isFinite(Date.parse(personal.next.due))).toBe(true);
    expect(personal.next.stability).not.toBe(standard.next.stability);
  });
});
