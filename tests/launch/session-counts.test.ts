import { it, expect } from "vitest";
import {
  applyReviewToCounts,
  revertReviewFromCounts,
} from "../../packages/scheduling/src/session-counts";
it("again stays due and exact undo restores new-card availability on both clients", () => {
  const now = new Date(2026, 8, 10, 12).getTime(),
    counts = { due: 0, new: 1, learning: 0, total: 8 };
  const before = { is_new: true, state: 0 },
    after = { state: 1, due: new Date(now + 60000).toISOString() };
  const next = applyReviewToCounts(counts, before, after, 4, now);
  expect(next).toEqual({ due: 1, new: 0, learning: 1, total: 8 });
  expect(revertReviewFromCounts(next, before, after, 4, now)).toEqual(counts);
});
it("an answer due after rollover leaves today, while invalid dates never add a due card", () => {
  const now = new Date(2026, 8, 10, 12).getTime();
  const before = { is_new: false, state: 2 },
    counts = { due: 1, new: 0, learning: 0 };
  for (const due of [new Date(2026, 8, 11, 4).toISOString(), "invalid"])
    expect(
      applyReviewToCounts(counts, before, { state: 2, due }, 4, now).due,
    ).toBe(0);
});
