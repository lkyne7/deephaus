import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAllRows, isMissingSchema } from "./db";
import {
  PUBLICATION_CARD_COLUMNS,
  type DeckPublication,
  type PublicationCardContent,
} from "./types";

type ProjectCard = PublicationCardContent & { source_card_id: string };

/** Fields that arrive with the Community listing migration. */
const LISTING_COLUMNS = ["subject", "content_updated_at"] as const;

export type PublishOptions = {
  /** Listing title. A first publish defaults to the deck's name; a republish keeps the listing's. */
  title?: string;
  /** `undefined` keeps the current description; null or "" clears it. */
  description?: string | null;
  /** `undefined` keeps the current subject; null clears it. */
  subject?: string | null;
};

async function loadProjectCards(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectCard[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("cards")
      .select(
        `id, ${PUBLICATION_CARD_COLUMNS}, generation_jobs!inner(source_id, sources!inner(project_id))`,
      )
      .eq("generation_jobs.sources.project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  return rows.map((c) => ({
    source_card_id: c.id as string,
    type: c.type as ProjectCard["type"],
    front: c.front as string | null,
    back: c.back as string | null,
    cloze_text: c.cloze_text as string | null,
    extra: c.extra as string | null,
    occlusion_data: c.occlusion_data ?? null,
    tags: (c.tags as string[] | null) ?? [],
    sort_order: c.sort_order as number,
  }));
}

async function replacePublicationCards(
  supabase: SupabaseClient,
  publicationId: string,
  cards: ProjectCard[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("publication_cards")
    .delete()
    .eq("publication_id", publicationId);

  if (deleteError) throw new Error(deleteError.message);

  const rows = cards.map((c) => ({
    publication_id: publicationId,
    type: c.type,
    front: c.front,
    back: c.back,
    cloze_text: c.cloze_text,
    extra: c.extra,
    occlusion_data: c.occlusion_data,
    tags: c.tags,
    sort_order: c.sort_order,
    // Lets a learner's copy be updated card by card instead of replaced.
    source_card_id: c.source_card_id,
  }));

  for (const batch of chunk(rows, 500)) {
    let { error } = await supabase.from("publication_cards").insert(batch);
    if (error && isMissingSchema(error)) {
      ({ error } = await supabase
        .from("publication_cards")
        .insert(batch.map(({ source_card_id: _source, ...row }) => row)));
    }
    if (error) throw new Error(error.message);
  }
}

/** Write a publication row, retrying without the listing columns if they aren't there yet. */
async function writePublication(
  run: (values: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>,
  values: Record<string, unknown>,
): Promise<DeckPublication> {
  let { data, error } = await run(values);
  if (error && isMissingSchema(error)) {
    const core = { ...values };
    for (const column of LISTING_COLUMNS) delete core[column];
    ({ data, error } = await run(core));
  }
  if (error || !data) throw new Error(error?.message ?? "Publish failed");
  return data as DeckPublication;
}

export async function publishProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  opts: PublishOptions = {},
): Promise<DeckPublication> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, deck_name, name, user_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) throw new Error("Deck not found");
  if (project.user_id !== userId) throw new Error("Not authorized");

  // A copy of someone else's deck is theirs to publish, not this user's.
  const { data: addedFrom } = await supabase
    .from("deck_subscriptions")
    .select("id")
    .eq("local_project_id", projectId)
    .limit(1);
  if ((addedFrom ?? []).length > 0) {
    throw new Error("Decks added from Community can't be published");
  }

  const cards = await loadProjectCards(supabase, projectId);
  if (cards.length === 0) throw new Error("Publish a deck with at least one card");

  const { data: existing } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("source_project_id", projectId)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    // A republish refreshes the cards. The listing's own words only change when sent.
    const values: Record<string, unknown> = {
      title: opts.title?.trim() || existing.title,
      version: existing.version + 1,
      card_count: cards.length,
      updated_at: now,
      content_updated_at: now,
    };
    if (opts.description !== undefined) values.description = opts.description?.trim() || null;
    if (opts.subject !== undefined) values.subject = opts.subject || null;

    const updated = await writePublication(
      (row) => supabase.from("deck_publications").update(row).eq("id", existing.id).select("*").single(),
      values,
    );
    await replacePublicationCards(supabase, existing.id, cards);
    return updated;
  }

  const created = await writePublication(
    (row) => supabase.from("deck_publications").insert(row).select("*").single(),
    {
      publisher_id: userId,
      source_project_id: projectId,
      title: opts.title?.trim() || project.deck_name || project.name,
      description: opts.description?.trim() || null,
      subject: opts.subject || null,
      card_count: cards.length,
      content_updated_at: now,
    },
  );
  await replacePublicationCards(supabase, created.id, cards);
  return created;
}

/** Edit the listing's own words without bumping the version or re-syncing cards. */
export async function updatePublicationListing(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  changes: { title?: string; description?: string | null; subject?: string | null },
): Promise<DeckPublication> {
  const { data: existing, error: existingError } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("source_project_id", projectId)
    .eq("publisher_id", userId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Deck is not published");

  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (changes.title?.trim()) values.title = changes.title.trim();
  if (changes.description !== undefined) values.description = changes.description?.trim() || null;
  if (changes.subject !== undefined) values.subject = changes.subject || null;

  return writePublication(
    (row) => supabase.from("deck_publications").update(row).eq("id", existing.id).select("*").single(),
    values,
  );
}

export async function unpublishProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<void> {
  const { data: publication } = await supabase
    .from("deck_publications")
    .select("id, publisher_id")
    .eq("source_project_id", projectId)
    .maybeSingle();

  if (!publication) return;
  if (publication.publisher_id !== userId) throw new Error("Not authorized");

  const { error } = await supabase.from("deck_publications").delete().eq("id", publication.id);
  if (error) throw new Error(error.message);
}
