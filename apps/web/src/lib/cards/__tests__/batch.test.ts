import { describe, expect, it } from "vitest";
import { CardBatchError, moveCards, normalizeTag, tagCards } from "@/lib/cards/batch";
import { fakeSupabase, projectCards, type Row, type Tables } from "@/lib/community/__tests__/fake-supabase";

function card(id: string, jobId: string, sortOrder: number, extra: Partial<Row> = {}): Row {
  return {
    id,
    job_id: jobId,
    type: "basic",
    front: `Question ${id}`,
    back: `Answer ${id}`,
    cloze_text: null,
    extra: null,
    occlusion_data: null,
    tags: [],
    sort_order: sortOrder,
    source_chunk_id: "chunk-1",
    source_ref: "p. 3",
    source_quote: "a quote",
    ...extra,
  };
}

/** Two decks with cards, and a third with nothing in it yet. */
function seed(): Tables {
  return {
    projects: [
      { id: "bio", user_id: "me" },
      { id: "chem", user_id: "me" },
      { id: "empty", user_id: "me" },
      { id: "theirs", user_id: "someone-else" },
    ],
    sources: [
      { id: "bio-src", project_id: "bio" },
      { id: "chem-src", project_id: "chem" },
    ],
    generation_jobs: [
      { id: "bio-job", source_id: "bio-src", created_at: "2026-01-01T00:00:00Z" },
      { id: "chem-job-old", source_id: "chem-src", created_at: "2026-01-01T00:00:00Z" },
      { id: "chem-job", source_id: "chem-src", created_at: "2026-02-01T00:00:00Z" },
    ],
    cards: [
      card("b1", "bio-job", 0),
      card("b2", "bio-job", 1),
      card("b3", "bio-job", 2),
      card("c1", "chem-job-old", 0),
      card("c2", "chem-job", 7),
    ],
    card_reviews: [{ id: "r1", card_id: "b2", user_id: "me", reps: 4 }],
    deck_subscriptions: [],
  };
}

const ids = (rows: Row[]) => rows.map((row) => row.id).sort();
const byId = (tables: Tables, id: string) => tables.cards.find((row) => row.id === id)!;

describe("moveCards", () => {
  it("moves cards to the end of the other deck, with their reviews", async () => {
    const tables = seed();
    const result = await moveCards(fakeSupabase(tables) as never, "me", ["b3", "b2"], "chem");

    expect(result).toEqual({ moved: 2, already_there: 0, kept_for_images: 0 });
    expect(ids(projectCards(tables, "bio"))).toEqual(["b1"]);
    expect(ids(projectCards(tables, "chem"))).toEqual(["b2", "b3", "c1", "c2"]);
    // The deck's newest job takes them, after its last card and in their old order.
    expect(byId(tables, "b2")).toMatchObject({ job_id: "chem-job", sort_order: 8 });
    expect(byId(tables, "b3")).toMatchObject({ job_id: "chem-job", sort_order: 9 });
    // The old source stays behind, so the link to a passage of it is cleared.
    expect(byId(tables, "b2")).toMatchObject({ source_chunk_id: null, source_ref: null, source_quote: null });
    expect(tables.card_reviews).toEqual([{ id: "r1", card_id: "b2", user_id: "me", reps: 4 }]);
  });

  it("gives a deck with no cards a job to hold them", async () => {
    const tables = seed();
    const result = await moveCards(fakeSupabase(tables) as never, "me", ["b1"], "empty");

    expect(result.moved).toBe(1);
    expect(ids(projectCards(tables, "empty"))).toEqual(["b1"]);
    expect(byId(tables, "b1").sort_order).toBe(0);
    expect(tables.sources.filter((source) => source.project_id === "empty")).toHaveLength(1);
  });

  it("leaves cards that are already in the deck", async () => {
    const tables = seed();
    const result = await moveCards(fakeSupabase(tables) as never, "me", ["c1", "b1"], "chem");

    expect(result).toEqual({ moved: 1, already_there: 1, kept_for_images: 0 });
    expect(byId(tables, "c1")).toMatchObject({ job_id: "chem-job-old", sort_order: 0, source_ref: "p. 3" });
  });

  it("keeps a card whose image lives in its source's folder", async () => {
    const tables = seed();
    byId(tables, "b1").back = '<img src="https://x.supabase.co/storage/v1/object/public/card-media/me/source-media/bio-src/fig.png">';
    byId(tables, "b2").occlusion_data = { imageUrl: "https://x.supabase.co/card-media/me/source-media/bio-src/heart.png" };
    const result = await moveCards(fakeSupabase(tables) as never, "me", ["b1", "b2", "b3"], "chem");

    expect(result).toEqual({ moved: 1, already_there: 0, kept_for_images: 2 });
    expect(ids(projectCards(tables, "bio"))).toEqual(["b1", "b2"]);
  });

  it("refuses a deck that follows a Community deck, on either side", async () => {
    const tables = seed();
    tables.deck_subscriptions.push({ id: "s1", local_project_id: "chem", sync_mode: "follow" });
    const supabase = fakeSupabase(tables) as never;

    await expect(moveCards(supabase, "me", ["b1"], "chem")).rejects.toThrow(/can't be moved into it/);
    await expect(moveCards(supabase, "me", ["c1"], "bio")).rejects.toThrow(/can't be moved out of/);
    expect(ids(projectCards(tables, "bio"))).toEqual(["b1", "b2", "b3"]);

    // A personal copy no longer changes with its author, so it is an ordinary deck.
    tables.deck_subscriptions[0].sync_mode = "fork";
    expect((await moveCards(supabase, "me", ["b1"], "chem")).moved).toBe(1);
  });

  it("refuses a deck that isn't the user's", async () => {
    const tables = seed();
    const attempt = moveCards(fakeSupabase(tables) as never, "me", ["b1"], "theirs");
    await expect(attempt).rejects.toBeInstanceOf(CardBatchError);
    await expect(attempt).rejects.toMatchObject({ status: 404 });
    expect(ids(projectCards(tables, "bio"))).toEqual(["b1", "b2", "b3"]);
  });
});

describe("tagCards", () => {
  it("adds a tag to the cards that lack it and leaves the rest alone", async () => {
    const tables = seed();
    byId(tables, "b1").tags = ["cells"];
    byId(tables, "b2").tags = ["exam", "cells"];
    const result = await tagCards(fakeSupabase(tables) as never, ["b1", "b2", "b3"], "  exam ", "tag");

    expect(result).toEqual({ updated: 2, tag: "exam" });
    expect(byId(tables, "b1").tags).toEqual(["cells", "exam"]);
    expect(byId(tables, "b2").tags).toEqual(["exam", "cells"]);
    expect(byId(tables, "b3").tags).toEqual(["exam"]);
    expect(byId(tables, "c1").tags).toEqual([]);
  });

  it("takes a tag off the cards that have it", async () => {
    const tables = seed();
    byId(tables, "b1").tags = ["cells", "exam"];
    byId(tables, "b2").tags = ["exam"];
    const result = await tagCards(fakeSupabase(tables) as never, ["b1", "b2", "b3"], "exam", "untag");

    expect(result).toEqual({ updated: 2, tag: "exam" });
    expect(byId(tables, "b1").tags).toEqual(["cells"]);
    expect(byId(tables, "b2").tags).toEqual([]);
  });

  it("stores a tag without commas or stray spaces, and refuses an empty one", async () => {
    expect(normalizeTag(" cell,  biology ")).toBe("cell biology");
    expect(normalizeTag(" , ")).toBeNull();
    expect(normalizeTag("x".repeat(81))).toBeNull();
    await expect(tagCards(fakeSupabase(seed()) as never, ["b1"], " , ", "tag")).rejects.toMatchObject({
      status: 400,
    });
  });
});
