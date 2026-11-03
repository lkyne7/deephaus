import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ensureSourceChunks } from "../source-chunks";

vi.mock("@deephaus/llm", () => ({ embedTexts: vi.fn() }));

describe("persisted textbook chunks", () => {
  it("loads provenance beyond the database response limit", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({
      id: `chunk-${index}`, chunk_index: index, source_ref: `PDF::Page${index + 1}`,
      page_start: index + 1, page_end: index + 1,
    }));
    const range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    const result = await ensureSourceChunks(db, { id: "book", type: "pdf", raw_text: null });
    expect(result).toEqual(rows);
    expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(result.at(-1)?.page_start).toBe(1201);
  });
});
