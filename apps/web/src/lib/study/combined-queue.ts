/**
 * One review session across every deck with work today.
 *
 * Decks are chained rather than merged: each deck's queue still comes from
 * `/api/decks/{id}/review`, so its new-card limit, its scheduler settings and
 * the offline replica fallback all apply unchanged, and grading stays per card.
 */

type QueueCard = { queue_key: string };

type QueuePage<C extends QueueCard> = { cards: C[]; learn_ahead?: boolean };

export type ReviewDeckSummary = { id: string; due: number; new: number; waiting: number };

export type ChainedPage<P> = { deckId: string; queue: P };

export type StudyQueueChain<P> = {
  /** The next cards to study, leaving out `exclude`, or null when every deck is finished. */
  next: (exclude: ReadonlySet<string>) => Promise<ChainedPage<P> | null>;
};

/** Decks with cards waiting, due work first so new cards don't block reviews. */
export function pickReviewDecks<D extends ReviewDeckSummary>(decks: D[]): D[] {
  return decks
    .filter((deck) => deck.waiting > 0)
    .sort((a, b) => b.due - a.due || b.new - a.new);
}

/**
 * Walks `deckIds` in order. A deck is stayed on while it has cards to show now,
 * and left once it doesn't. After the last deck every deck is checked again, so
 * cards graded Again earlier come back, and only then is learn-ahead used.
 *
 * A deck that fails to load is skipped; the error only surfaces if nothing else
 * could be studied. Safe to call while an earlier call is in flight: the cursor
 * only moves past decks that had nothing to show.
 */
export function chainStudyQueues<C extends QueueCard, P extends QueuePage<C>>(
  deckIds: string[],
  fetchDeck: (deckId: string) => Promise<P>,
  onPage?: (deckId: string, queue: P) => void,
): StudyQueueChain<P> {
  let cursor = 0;

  return {
    async next(exclude) {
      let failure: unknown = null;
      const seen = new Map<string, P>();

      const load = async (deckId: string): Promise<P | null> => {
        try {
          const queue = await fetchDeck(deckId);
          onPage?.(deckId, queue);
          return { ...queue, cards: queue.cards.filter((card) => !exclude.has(card.queue_key)) };
        } catch (error) {
          failure = error;
          return null;
        }
      };

      while (cursor < deckIds.length) {
        const deckId = deckIds[cursor];
        const queue = await load(deckId);
        if (queue && queue.cards.length > 0 && !queue.learn_ahead) return { deckId, queue };
        if (queue) seen.set(deckId, queue);
        cursor += 1;
      }

      // Decks that failed above are in `unchecked`, so only a repeat failure counts.
      failure = null;
      const unchecked = deckIds.filter((deckId) => !seen.has(deckId));
      const swept = await Promise.all(unchecked.map(load));
      unchecked.forEach((deckId, index) => {
        const queue = swept[index];
        if (queue) seen.set(deckId, queue);
      });

      for (const deckId of deckIds) {
        const queue = seen.get(deckId);
        if (queue && queue.cards.length > 0) return { deckId, queue };
      }

      if (failure) throw failure;
      return null;
    },
  };
}

/** Sums per-deck count records into the totals shown in the session footer. */
export function sumQueueCounts<T extends { [K in keyof T]: number }>(
  byDeck: Record<string, T>,
  empty: T,
): T {
  const total = { ...empty };
  for (const counts of Object.values(byDeck)) {
    for (const key of Object.keys(empty) as Array<keyof T>) {
      total[key] = (total[key] + counts[key]) as T[keyof T];
    }
  }
  return total;
}
