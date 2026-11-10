import { describe, expect, it } from "vitest";
import { publishProject } from "@/lib/community/publish";
import { subscribeToPublication, syncFollowSubscriptionIfNeeded } from "@/lib/community/subscribe";
import { fakeSupabase, type Row } from "./fake-supabase";

const occlusion = {
  imageUrl: "https://project.supabase.co/storage/v1/object/public/card-media/pub/heart.png",
  rects: [
    { id: "a", x: 0.1, y: 0.1, width: 0.2, height: 0.2, ord: 1, enabled: true },
    { id: "b", x: 0.5, y: 0.5, width: 0.2, height: 0.2, ord: 2, enabled: true },
  ],
};

function seedPublisher(): Record<string, Row[]> {
  return {
    projects: [{ id: "deck", user_id: "publisher", name: "Anatomy", deck_name: "Anatomy" }],
    sources: [{ id: "src", project_id: "deck" }],
    generation_jobs: [{ id: "job", source_id: "src" }],
    cards: [
      {
        id: "card-basic",
        job_id: "job",
        type: "basic",
        front: "Q",
        back: "A",
        cloze_text: null,
        extra: null,
        occlusion_data: null,
        tags: [],
        sort_order: 0,
      },
      {
        id: "card-io",
        job_id: "job",
        type: "image-occlusion",
        front: `<img src="${occlusion.imageUrl}">`,
        back: null,
        cloze_text: null,
        extra: "Chambers",
        occlusion_data: occlusion,
        tags: ["heart"],
        sort_order: 1,
      },
    ],
    deck_publications: [],
    publication_cards: [],
    deck_subscriptions: [],
  };
}

const ioCards = (tables: Record<string, Row[]>, jobIds: unknown[]) =>
  tables.cards.filter((card) => jobIds.includes(card.job_id) && card.type === "image-occlusion");

describe("community decks keep image-occlusion data", () => {
  it("publishes, subscribes to and follow-syncs occlusion regions", async () => {
    const tables = seedPublisher();
    const supabase = fakeSupabase(tables) as never;

    const publication = await publishProject(supabase, "publisher", "deck");
    const published = tables.publication_cards.find((card) => card.type === "image-occlusion");
    expect(published?.occlusion_data).toEqual(occlusion);
    expect(tables.publication_cards.find((card) => card.type === "basic")?.occlusion_data).toBeNull();

    const { localProjectId } = await subscribeToPublication(
      supabase,
      "subscriber",
      publication.id,
      "follow",
    );
    const localJobs = tables.generation_jobs
      .filter((job) =>
        tables.sources.some((s) => s.id === job.source_id && s.project_id === localProjectId),
      )
      .map((job) => job.id);
    expect(ioCards(tables, localJobs).map((card) => card.occlusion_data)).toEqual([occlusion]);

    // Publisher adds a region and republishes; the follower picks it up.
    const moved = {
      ...occlusion,
      rects: [...occlusion.rects, { id: "c", x: 0.7, y: 0.1, width: 0.2, height: 0.2, ord: 3 }],
    };
    tables.cards.find((card) => card.id === "card-io")!.occlusion_data = moved;
    await publishProject(supabase, "publisher", "deck");
    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "subscriber")).toBe(true);
    expect(ioCards(tables, localJobs).map((card) => card.occlusion_data)).toEqual([moved]);
  });
});
