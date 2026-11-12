import { FSRS7Model } from "ts-fsrs/models/fsrs-7";

import {
  fsrs7MemoryFromFsrs6,
  hasFsrs7Memory,
  usableFsrs7Weights,
  type CardReviewRow,
  type Fsrs7Memory,
  type FsrsGrade,
  type FsrsModelVersion,
  type FsrsWeights,
} from "./fsrs.js";

const DAY_MS = 86_400_000;

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
  /** Card state the memory was read in. Picks how FSRS-6 memory converts. */
  state?: number;
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
    state: review.state,
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createEngine(weights: FsrsWeights | undefined): MemoryEngine {
  const fsrs7 = FSRS7Model.create({
    config: { weights: usableFsrs7Weights(weights?.fsrs7) },
  });
  const curve = (memory: Fsrs7Memory, elapsed: number) => fsrs7.forgettingCurve(memory, elapsed);

  // FSRS-6 memories are planned as the FSRS-7 memory grading will convert them
  // to. Planners ask about the same memory many times, so each is converted once.
  const converted = new WeakMap<Memory, Memory>();
  const asFsrs7 = (memory: Memory): Memory => {
    if (memory.model === 7) return memory;
    let next = converted.get(memory);
    if (!next) {
      const fsrs7Memory = fsrs7MemoryFromFsrs6(
        { stability: memory.stability, difficulty: memory.difficulty, state: memory.state ?? 2 },
        curve,
      );
      next = fsrs7Memory
        ? { model: 7, ...fsrs7Memory, lastReviewMs: memory.lastReviewMs, state: memory.state }
        : { ...memory, model: 7, stabilityFast: memory.stability };
      converted.set(memory, next);
    }
    return next;
  };
  const state = (memory: Memory): Fsrs7Memory => ({
    stability: memory.stability,
    stabilityFast: memory.stabilityFast,
    difficulty: memory.difficulty,
  });

  const elapsedDays = (memory: Memory, atMs: number) =>
    Math.max(0, (atMs - memory.lastReviewMs) / DAY_MS);

  return {
    recall(memory, atMs) {
      if (!memory) return 0;
      const current = asFsrs7(memory);
      return clamp01(curve(state(current), elapsedDays(current, atMs)));
    },

    review(memory, atMs, rating) {
      if (!memory) {
        // First reviews always start on the current model, as grading does.
        const next = fsrs7.step({ memoryState: null, elapsedDays: 0, rating });
        return { model: 7, ...next, lastReviewMs: atMs };
      }
      const current = asFsrs7(memory);
      const next = fsrs7.step({
        memoryState: state(current),
        elapsedDays: elapsedDays(current, atMs),
        rating,
      });
      return { model: 7, ...next, lastReviewMs: atMs };
    },

    intervalDays(memory, retention) {
      return fsrs7.nextInterval(state(asFsrs7(memory)), retention);
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
