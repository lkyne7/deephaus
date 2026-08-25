import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/api/fetch", () => ({ apiFetch }));

import {
  clearReviewQueueCache,
  consumeReviewQueue,
  prefetchReviewQueue,
} from "@/lib/study/review-cache";

describe("review queue prefetch cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReviewQueueCache();
    vi.stubGlobal("window", {});
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ cards: [{ id: "card-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearReviewQueueCache();
  });

  it("uses the authenticated offline-aware fetch path", async () => {
    prefetchReviewQueue("deck-1");
    await expect(consumeReviewQueue("deck-1")).resolves.toEqual({
      cards: [{ id: "card-1" }],
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/decks/deck-1/review", {
      cache: "no-store",
    });
  });

  it("clears prefetched user data at authentication boundaries", () => {
    prefetchReviewQueue("deck-1");
    clearReviewQueueCache();
    expect(consumeReviewQueue("deck-1")).toBeNull();
  });
});
