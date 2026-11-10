import { FSRS6Model } from "ts-fsrs/models/fsrs-6";
import { FSRS7Model } from "ts-fsrs/models/fsrs-7";

import {
  hasFsrs7Memory,
  usableFsrs6Weights,
  usableFsrs7Weights,
  type CardReviewRow,
  type FsrsGrade,
  type FsrsModelVersion,
  type FsrsWeights,
} from "./fsrs";

const DAY_MS = 86_400_000;
const RELEARNING_STEP_COUNT = 1;

/**
 * A card's memory, stripped to what the forgetting curve needs. Planners work
 * on this instead of full review rows so they can look ahead thousands of
 * times without replaying history, fuzzing intervals or formatting dates.
 */
export interface Memory {
  model: FsrsModelVersion;
  stability: number;
  /** FSRS-7's fast trace. Unused (0) on FSRS-6 memories. */
  stabilityFast: number;
  difficulty: number;
  lastReviewMs: number;
}

export interface MemoryEngine {
  /** Probability of recall at `atMs`. An unseen card (null) is 0. */
  recall(memory: Memory | null, atMs: number): number;
  /** Memory after one review at `atMs`. A null memory is a first review. */
  review(memory: Memory | null, atMs: number, rating: FsrsGrade): Memory;
  /** Days until recall falls to `retention`. */
  intervalDays(memory: Memory, retention: number): number;
}

/** The memory held by a stored review row, or null when the card is unseen. */
export function memoryFromReview(review: CardReviewRow | null | undefined): Memory | null {
  if (!review || review.state === 0 || !review.last_review) return null;
  const lastReviewMs = Date.parse(review.last_review);
  if (!Number.isFinite(lastReviewMs)) return null;
  if (hasFsrs7Memory(review)) {
    return {
      model: 7,
      stability: review.stability,
      stabilityFast: review.stability_fast as number,
      difficulty: review.difficulty,
      lastReviewMs,
    };
  }
  if (!(review.stability > 0)) return null;
  return {
    model: 6,
    stability: review.stability,
    stabilityFast: 0,
    difficulty: review.difficulty,
    lastReviewMs,
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createEngine(weights: FsrsWeights | undefined): MemoryEngine {
  const fsrs7 = FSRS7Model.create({
    config: { weights: usableFsrs7Weights(weights?.fsrs7) },
  });
  // Created on first use: most decks have no FSRS-6 cards left.
  let fsrs6: ReturnType<typeof FSRS6Model.create> | undefined;
  const getFsrs6 = () =>
    (fsrs6 ??= FSRS6Model.create({
      config: {
        weights: [...usableFsrs6Weights(weights?.fsrs6)],
        enableShortTerm: true,
        numRelearningSteps: RELEARNING_STEP_COUNT,
      },
    }));

  const elapsedDays = (memory: Memory, atMs: number) =>
    Math.max(0, (atMs - memory.lastReviewMs) / DAY_MS);

  return {
    recall(memory, atMs) {
      if (!memory) return 0;
      const elapsed = elapsedDays(memory, atMs);
      if (memory.model === 7) {
        return clamp01(
          fsrs7.forgettingCurve(
            {
              stability: memory.stability,
              stabilityFast: memory.stabilityFast,
              difficulty: memory.difficulty,
            },
            elapsed,
          ),
        );
      }
      // FSRS-6 grades in whole days, but its curve is continuous. Planning the
      // last day before an exam needs the hours, so the curve is read exactly.
      return clamp01(
        getFsrs6().forgettingCurve(
          { stability: memory.stability, difficulty: memory.difficulty },
          elapsed,
        ),
      );
    },

    review(memory, atMs, rating) {
      if (!memory) {
        // First reviews always start on the current model, as grading does.
        const next = fsrs7.step({ memoryState: null, elapsedDays: 0, rating });
        return { model: 7, ...next, lastReviewMs: atMs };
      }
      const elapsed = elapsedDays(memory, atMs);
      if (memory.model === 7) {
        const next = fsrs7.step({
          memoryState: {
            stability: memory.stability,
            stabilityFast: memory.stabilityFast,
            difficulty: memory.difficulty,
          },
          elapsedDays: elapsed,
          rating,
        });
        return { model: 7, ...next, lastReviewMs: atMs };
      }
      const next = getFsrs6().step({
        memoryState: { stability: memory.stability, difficulty: memory.difficulty },
        // Whole days, matching how FSRS-6 cards are graded.
        elapsedDays: Math.floor(elapsed),
        rating,
      });
      return {
        model: 6,
        stability: next.stability,
        stabilityFast: 0,
        difficulty: next.difficulty,
        lastReviewMs: atMs,
      };
    },

    intervalDays(memory, retention) {
      if (memory.model === 7) {
        return fsrs7.nextInterval(
          {
            stability: memory.stability,
            stabilityFast: memory.stabilityFast,
            difficulty: memory.difficulty,
          },
          retention,
        );
      }
      return getFsrs6().nextInterval(
        { stability: memory.stability, difficulty: memory.difficulty },
        retention,
      );
    },
  };
}

const engineCache = new Map<string, MemoryEngine>();
const ENGINE_CACHE_LIMIT = 64;

/**
 * Engines are pure functions of their weights, so one is kept per distinct
 * weight set (a user's own fit plus any deck presets).
 */
export function memoryEngine(weights?: FsrsWeights): MemoryEngine {
  const key = `${weights?.fsrs6?.join(",") ?? "default"}|${weights?.fsrs7?.join(",") ?? "default"}`;
  const cached = engineCache.get(key);
  if (cached) return cached;
  const engine = createEngine(weights);
  if (engineCache.size >= ENGINE_CACHE_LIMIT) engineCache.clear();
  engineCache.set(key, engine);
  return engine;
}
