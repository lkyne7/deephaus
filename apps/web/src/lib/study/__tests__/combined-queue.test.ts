import { describe, expect, it, vi } from "vitest";
import {
  chainStudyQueues,
  pickReviewDecks,
  sumQueueCounts,
} from "@/lib/study/combined-queue";

type Page = { cards: Array<{ queue_key: string }>; learn_ahead?: boolean };

const page = (keys: string[], learn_ahead = false): Page => ({
  cards: keys.map((queue_key) => ({ queue_key })),
  learn_ahead,
});

/** Each deck answers with the next scripted page, then an empty one. */
function scripted(script: Record<string, Page[]>) {
  const calls: string[] = [];
  const fetchDeck = vi.fn(async (deckId: string) => {
    calls.push(deckId);
    return script[deckId]?.shift() ?? page([]);
  });
  return { calls, fetchDeck };
}

const nothing = new Set<string>();

describe("pickReviewDecks", () => {
  it("keeps decks with work and puts due decks before new-only ones", () => {
    const decks = [
      { id: "new-only", due: 0, new: 9, waiting: 9 },
      { id: "empty", due: 0, new: 0, waiting: 0 },
      { id: "few-due", due: 2, new: 0, waiting: 2 },
      { id: "many-due", due: 8, new: 1, waiting: 9 },
    ];
    expect(pickReviewDecks(decks).map((deck) => deck.id)).toEqual([
      "many-due",
      "few-due",
      "new-only",
    ]);
  });
});

describe("chainStudyQueues", () => {
  it("stays on a deck until it has nothing to show, then moves on", async () => {
    const { fetchDeck } = scripted({
      a: [page(["a1"]), page(["a2"])],
      b: [page(["b1"])],
    });
    const chain = chainStudyQueues(["a", "b"], fetchDeck);

    expect((await chain.next(nothing))?.deckId).toBe("a");
    expect((await chain.next(nothing))?.queue.cards).toEqual([{ queue_key: "a2" }]);
    expect((await chain.next(nothing))?.deckId).toBe("b");
    expect(await chain.next(nothing)).toBeNull();
  });

  it("drops excluded cards, and leaves a deck when only those remain", async () => {
    const { fetchDeck } = scripted({ a: [page(["a1"])], b: [page(["b1", "b2"])] });
    const chain = chainStudyQueues(["a", "b"], fetchDeck);

    const next = await chain.next(new Set(["a1", "b1"]));
    expect(next?.deckId).toBe("b");
    expect(next?.queue.cards).toEqual([{ queue_key: "b2" }]);
  });

  it("finishes the other decks before pulling learning cards ahead", async () => {
    const { fetchDeck } = scripted({
      a: [page(["a-ahead"], true), page(["a-ahead"], true)],
      b: [page(["b1"])],
    });
    const chain = chainStudyQueues(["a", "b"], fetchDeck);

    expect((await chain.next(nothing))?.deckId).toBe("b");
    const swept = await chain.next(nothing);
    expect(swept?.deckId).toBe("a");
    expect(swept?.queue.cards).toEqual([{ queue_key: "a-ahead" }]);
  });

  it("brings back cards that came due in a finished deck", async () => {
    const { fetchDeck } = scripted({ a: [page([]), page(["a-again"])], b: [page(["b1"])] });
    const chain = chainStudyQueues(["a", "b"], fetchDeck);

    expect((await chain.next(nothing))?.deckId).toBe("b");
    expect((await chain.next(nothing))?.deckId).toBe("a");
  });

  it("checks a single deck once when it is empty", async () => {
    const { calls, fetchDeck } = scripted({});
    expect(await chainStudyQueues(["a"], fetchDeck).next(nothing)).toBeNull();
    expect(calls).toEqual(["a"]);
  });

  it("uses a single deck's learn-ahead page without fetching it twice", async () => {
    const { calls, fetchDeck } = scripted({ a: [page(["a-ahead"], true)] });
    const next = await chainStudyQueues(["a"], fetchDeck).next(nothing);
    expect(next?.queue.learn_ahead).toBe(true);
    expect(calls).toEqual(["a"]);
  });

  it("skips a deck that fails while others can be studied", async () => {
    const fetchDeck = vi.fn(async (deckId: string) => {
      if (deckId === "a") throw new Error("These cards need media");
      return page(["b1"]);
    });
    const next = await chainStudyQueues(["a", "b"], fetchDeck).next(nothing);
    expect(next?.deckId).toBe("b");
  });

  it("reports the failure when nothing else can be studied", async () => {
    const fetchDeck = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(chainStudyQueues(["a"], fetchDeck).next(nothing)).rejects.toThrow("offline");
  });

  it("does not report a failure when decks are simply finished", async () => {
    let calls = 0;
    const fetchDeck = vi.fn(async (deckId: string) => {
      calls += 1;
      if (deckId === "a" && calls === 1) throw new Error("flaky");
      return page([]);
    });
    const chain = chainStudyQueues(["a", "b"], fetchDeck);
    await expect(chain.next(nothing)).resolves.toBeNull();
  });

  it("passes each fetched page to onPage, before exclusion", async () => {
    const { fetchDeck } = scripted({ a: [page(["a1"])] });
    const onPage = vi.fn();
    await chainStudyQueues(["a"], fetchDeck, onPage).next(new Set(["a1"]));
    expect(onPage.mock.calls[0]?.[0]).toBe("a");
    expect(onPage.mock.calls[0]?.[1].cards).toHaveLength(1);
  });
});

describe("sumQueueCounts", () => {
  it("adds up each deck's counts", () => {
    const empty = { due: 0, new: 0 };
    expect(
      sumQueueCounts({ a: { due: 2, new: 1 }, b: { due: 3, new: 0 } }, empty),
    ).toEqual({ due: 5, new: 1 });
    expect(sumQueueCounts({}, empty)).toEqual(empty);
  });
});
