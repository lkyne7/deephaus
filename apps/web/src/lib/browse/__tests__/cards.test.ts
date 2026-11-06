import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadBrowseCards } from "../cards";

function rows(count: number, start = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${start + i}`,
    type: "basic",
    suspended: (start + i) % 3 === 0,
  }));
}

/** Serves `total` cards through the browse_cards contract, capped at 1000 rows per call. */
function supabaseWith(total: number) {
  const rpc = vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => {
    const limit = Math.min(args.p_limit, 1000);
    const count = Math.max(0, Math.min(limit, total - args.p_offset));
    return {
      data: rows(count, args.p_offset).map((row) => ({ ...row, total_count: total })),
      error: null,
    };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("loadBrowseCards", () => {
  it("passes paging straight to the RPC without a state filter", async () => {
    const { client, rpc } = supabaseWith(120);
    const result = await loadBrowseCards(client, "user", { limit: 50, offset: 50 });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 50, p_offset: 50 });
    expect(result.cards[0].id).toBe("card-50");
    expect(result.total).toBe(120);
  });

  it("returns exact totals and pages for suspended cards", async () => {
    const { client } = supabaseWith(90);
    const result = await loadBrowseCards(client, "user", {
      state: "suspended",
      limit: 10,
      offset: 10,
    });

    expect(result.total).toBe(30);
    expect(result.cards).toHaveLength(10);
    expect(result.cards[0].id).toBe("card-30");
    expect(result.cards.every((card) => card.suspended)).toBe(true);
  });

  it("walks every chunk for active cards", async () => {
    const { client, rpc } = supabaseWith(2500);
    const result = await loadBrowseCards(client, "user", { state: "active", limit: 50 });

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(1666);
    expect(result.cards.every((card) => !card.suspended)).toBe(true);
  });

  it("returns nothing when no card is in the requested state", async () => {
    const { client } = supabaseWith(0);
    const result = await loadBrowseCards(client, "user", { state: "suspended" });

    expect(result).toMatchObject({ cards: [], total: 0 });
  });
});
