export type SessionQueueCounts = { due: number; learning: number; new: number };

function isLearningState(state: number) {
  return state === 1 || state === 3;
}

export function cardCountBucket(card: {
  is_new: boolean;
  state: number;
}): "new" | "learning" | "review" {
  if (card.is_new || card.state === 0) return "new";
  if (isLearningState(card.state)) return "learning";
  return "review";
}

export function removeCardFromCounts<T extends SessionQueueCounts>(
  counts: T,
  bucket: "new" | "learning" | "review",
): T {
  if (bucket === "new") {
    return { ...counts, new: Math.max(0, counts.new - 1) };
  }
  if (bucket === "learning") {
    return {
      ...counts,
      learning: Math.max(0, counts.learning - 1),
      due: Math.max(0, counts.due - 1),
    };
  }
  return { ...counts, due: Math.max(0, counts.due - 1) };
}

/** Due before the next day-rollover boundary (Anki's "next day starts at"). */
function isStillDueToday(
  dueIso: string,
  asOfMs: number,
  dayStartHour: number,
): boolean {
  const dueMs = new Date(dueIso).getTime();
  if (!Number.isFinite(dueMs)) return false;
  if (dueMs <= asOfMs) return true;
  const boundary = new Date(asOfMs);
  boundary.setHours(dayStartHour, 0, 0, 0);
  if (boundary.getTime() <= asOfMs) boundary.setDate(boundary.getDate() + 1);
  return dueMs < boundary.getTime();
}

function addDueCardToCounts<T extends SessionQueueCounts>(
  counts: T,
  state: number,
  dueIso: string,
  asOfMs: number,
  dayStartHour: number,
): T {
  if (!isStillDueToday(dueIso, asOfMs, dayStartHour)) return counts;
  if (state === 0) {
    return { ...counts, new: counts.new + 1 };
  }
  if (isLearningState(state)) {
    return { ...counts, learning: counts.learning + 1, due: counts.due + 1 };
  }
  if (state === 2) {
    return { ...counts, due: counts.due + 1 };
  }
  return counts;
}

/** Apply a successful review to deck-wide daily remaining counts. */
export function applyReviewToCounts<T extends SessionQueueCounts>(
  counts: T,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string } | null,
  dayStartHour: number,
  asOfMs = Date.now(),
): T {
  if (!after) return removeCardFromCounts(counts, cardCountBucket(before));
  return addDueCardToCounts(
    removeCardFromCounts(counts, cardCountBucket(before)),
    after.state,
    after.due,
    asOfMs,
    dayStartHour,
  );
}

/** Undo a review's effect on deck-wide daily remaining counts. */
export function revertReviewFromCounts<T extends SessionQueueCounts>(
  counts: T,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string } | null,
  dayStartHour: number,
  asOfMs = Date.now(),
): T {
  let next = counts;
  if (after && isStillDueToday(after.due, asOfMs, dayStartHour)) {
    if (after.state === 0) {
      next = { ...next, new: Math.max(0, next.new - 1) };
    } else if (isLearningState(after.state)) {
      next = {
        ...next,
        learning: Math.max(0, next.learning - 1),
        due: Math.max(0, next.due - 1),
      };
    } else if (after.state === 2) {
      next = { ...next, due: Math.max(0, next.due - 1) };
    }
  }

  const bucket = cardCountBucket(before);
  if (bucket === "new") return { ...next, new: next.new + 1 };
  if (bucket === "learning") {
    return { ...next, learning: next.learning + 1, due: next.due + 1 };
  }
  return { ...next, due: next.due + 1 };
}
