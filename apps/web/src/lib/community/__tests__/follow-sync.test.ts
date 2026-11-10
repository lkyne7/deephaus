import { describe, expect, it } from "vitest";
import { publishProject, updatePublicationListing } from "@/lib/community/publish";
import {
  convertSubscriptionToCopy,
  subscribeToPublication,
  syncFollowSubscriptionIfNeeded,
} from "@/lib/community/subscribe";
import { fakeSupabase, projectCards, type FakeOptions, type Row, type Tables } from "./fake-supabase";

function card(id: string, front: string, back: string, sortOrder: number, tags: string[] = []): Row {
  return {
    id,
    job_id: "job",
    type: "basic",
    front,
    back,
    cloze_text: null,
    extra: null,
    occlusion_data: null,
    tags,
    sort_order: sortOrder,
  };
}

function seed(): Tables {
  return {
    projects: [{ id: "deck", user_id: "author", name: "Lecture 4.pdf", deck_name: "Lecture 4.pdf" }],
    sources: [{ id: "src", project_id: "deck" }],
    generation_jobs: [{ id: "job", source_id: "src", created_at: "2026-01-01T00:00:00Z" }],
    cards: [
      card("a", "Capital of France?", "Paris", 0),
      card("b", "Capital of Spain?", "Madrid", 1),
      card("c", "Capital of Italy?", "Rome", 2),
    ],
    deck_publications: [],
    publication_cards: [],
    deck_subscriptions: [],
    deck_subscription_cards: [],
    card_reviews: [],
  };
}

/** A learner follows the author's deck and reviews every card once. */
async function follow(tables: Tables, options?: FakeOptions) {
  const supabase = fakeSupabase(tables, options) as never;
  const publication = await publishProject(supabase, "author", "deck");
  const { localProjectId } = await subscribeToPublication(supabase, "learner", publication.id, "follow");
  for (const local of projectCards(tables, localProjectId)) {
    tables.card_reviews.push({ id: `review-${local.id}`, card_id: local.id, reps: 3 });
  }
  const byFront = () =>
    Object.fromEntries(projectCards(tables, localProjectId).map((c) => [c.front as string, c]));
  return { supabase, publication, localProjectId, byFront };
}

const authorCard = (tables: Tables, id: string) => tables.cards.find((c) => c.id === id)!;

describe("following a published deck", () => {
  it("keeps the learner's cards and reviews when the author republishes", async () => {
    const tables = seed();
    const { supabase, localProjectId, byFront } = await follow(tables);
    const before = byFront();

    // The author fixes one card, drops one and adds one.
    authorCard(tables, "b").back = "Madrid (since 1561)";
    tables.cards = tables.cards.filter((c) => c.id !== "c");
    tables.cards.push(card("d", "Capital of Portugal?", "Lisbon", 3));
    await publishProject(supabase, "author", "deck");

    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner")).toBe(true);
    const after = byFront();

    // Untouched and edited cards are the same rows, so their history still hangs off them.
    expect(after["Capital of France?"].id).toBe(before["Capital of France?"].id);
    expect(after["Capital of Spain?"].id).toBe(before["Capital of Spain?"].id);
    expect(after["Capital of Spain?"].back).toBe("Madrid (since 1561)");
    expect(after["Capital of Italy?"]).toBeUndefined();
    expect(after["Capital of Portugal?"].back).toBe("Lisbon");

    const reviewed = tables.card_reviews.map((review) => review.card_id);
    expect(reviewed).toContain(before["Capital of France?"].id);
    expect(reviewed).toContain(before["Capital of Spain?"].id);
    expect(reviewed).not.toContain(before["Capital of Italy?"].id);

    // Nothing more to do until the next republish.
    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner")).toBe(false);
  });

  it("follows a card whose question changed, by its link rather than its text", async () => {
    const tables = seed();
    const { supabase, localProjectId, byFront } = await follow(tables);
    const before = byFront();

    authorCard(tables, "a").front = "What is the capital of France?";
    await publishProject(supabase, "author", "deck");
    await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner");

    const after = byFront();
    expect(after["What is the capital of France?"].id).toBe(before["Capital of France?"].id);
    expect(projectCards(tables, localProjectId)).toHaveLength(3);
    expect(tables.card_reviews).toHaveLength(3);
  });

  it("leaves alone the cards the learner added to their copy", async () => {
    const tables = seed();
    const { supabase, localProjectId } = await follow(tables);
    const importJob = projectCards(tables, localProjectId)[0].job_id;
    tables.cards.push({ ...card("mine-1", "My own note", "Kept", 50), job_id: importJob });
    const localSource = tables.sources.find((s) => s.project_id === localProjectId)!;
    tables.generation_jobs.push({ id: "my-job", source_id: localSource.id, created_at: "2026-06-01T00:00:00Z" });
    tables.cards.push({ ...card("mine-2", "From my own PDF", "Kept", 51), job_id: "my-job" });

    tables.cards = tables.cards.filter((c) => c.id !== "c");
    await publishProject(supabase, "author", "deck");
    await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner");

    const ids = projectCards(tables, localProjectId).map((c) => c.id);
    expect(ids).toContain("mine-1");
    expect(ids).toContain("mine-2");
    expect(ids).toHaveLength(4);
  });

  it("links a copy made before links existed by what its cards say", async () => {
    const tables = seed();
    const { supabase, localProjectId, byFront } = await follow(tables);
    const before = byFront();
    tables.deck_subscription_cards = [];

    authorCard(tables, "b").tags = ["europe"];
    await publishProject(supabase, "author", "deck");
    await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner");

    const after = byFront();
    for (const front of Object.keys(before)) expect(after[front].id).toBe(before[front].id);
    expect(after["Capital of Spain?"].tags).toEqual(["europe"]);
    expect(tables.card_reviews).toHaveLength(3);
    // Now linked, so a reworded card is followed from here on.
    expect(tables.deck_subscription_cards).toHaveLength(3);
  });

  it("still publishes, adds and updates before the migration is applied", async () => {
    const tables = seed();
    delete tables.deck_subscription_cards;
    const { supabase, publication, localProjectId, byFront } = await follow(tables, {
      missingTables: ["deck_subscription_cards"],
      missingColumns: {
        deck_publications: ["subject", "content_updated_at"],
        publication_cards: ["source_card_id"],
      },
    });
    expect(publication.title).toBe("Lecture 4.pdf");
    const before = byFront();

    tables.cards.push(card("d", "Capital of Portugal?", "Lisbon", 3));
    await publishProject(supabase, "author", "deck", { subject: "history" });
    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner")).toBe(true);

    const after = byFront();
    expect(Object.keys(after)).toHaveLength(4);
    expect(after["Capital of France?"].id).toBe(before["Capital of France?"].id);
    expect(tables.card_reviews).toHaveLength(3);
  });

  it("stops changing a copy once the learner stops following", async () => {
    const tables = seed();
    const { supabase, publication, localProjectId } = await follow(tables);

    await convertSubscriptionToCopy(supabase, "learner", publication.id);
    tables.cards = tables.cards.filter((c) => c.id !== "b" && c.id !== "c");
    await publishProject(supabase, "author", "deck");

    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "learner")).toBe(false);
    expect(projectCards(tables, localProjectId)).toHaveLength(3);
    await expect(convertSubscriptionToCopy(supabase, "someone-else", publication.id)).rejects.toThrow(
      "Not in your decks",
    );
  });
});

describe("publishing a deck", () => {
  it("gives the listing its own title, and keeps it when the cards are republished", async () => {
    const tables = seed();
    const supabase = fakeSupabase(tables) as never;

    const first = await publishProject(supabase, "author", "deck", {
      title: "European capitals",
      description: "Every capital, west to east.",
      subject: "history",
    });
    expect(first).toMatchObject({ title: "European capitals", subject: "history", version: 1, card_count: 3 });
    expect(tables.projects[0].deck_name).toBe("Lecture 4.pdf");

    tables.cards.push(card("d", "Capital of Portugal?", "Lisbon", 3));
    const second = await publishProject(supabase, "author", "deck");
    expect(second).toMatchObject({
      title: "European capitals",
      description: "Every capital, west to east.",
      subject: "history",
      version: 2,
      card_count: 4,
    });
    expect(tables.publication_cards.map((c) => c.source_card_id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("edits the listing's words without republishing the cards", async () => {
    const tables = seed();
    const supabase = fakeSupabase(tables) as never;
    await publishProject(supabase, "author", "deck", { description: "Old words" });

    const updated = await updatePublicationListing(supabase, "author", "deck", {
      title: "  Capitals  ",
      description: "",
      subject: "history",
    });
    expect(updated).toMatchObject({ title: "Capitals", description: null, subject: "history", version: 1 });

    await expect(
      updatePublicationListing(supabase, "someone-else", "deck", { title: "Mine now" }),
    ).rejects.toThrow("Deck is not published");
  });

  it("refuses a deck that was added from Community", async () => {
    const tables = seed();
    const { supabase, localProjectId } = await follow(tables);
    await expect(publishProject(supabase, "learner", localProjectId)).rejects.toThrow(
      "Decks added from Community can't be published",
    );
  });

  it("stops someone adding their own deck, or the same deck twice", async () => {
    const tables = seed();
    const { supabase, publication } = await follow(tables);
    await expect(subscribeToPublication(supabase, "author", publication.id, "follow")).rejects.toThrow(
      "This is your own deck",
    );
    await expect(subscribeToPublication(supabase, "learner", publication.id, "fork")).rejects.toThrow(
      "Already in your decks",
    );
  });
});
