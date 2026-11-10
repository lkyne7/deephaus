import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAllRows, isMissingSchema } from "./db";
import { PUBLICATION_CARD_COLUMNS, type PublicationCardContent } from "./types";

/** A published card as a learner's copy receives it. */
export type IncomingCard = PublicationCardContent & { source_card_id?: string | null };

type CardInsert = PublicationCardContent & { id: string; job_id: string };

function cardFields(card: PublicationCardContent): PublicationCardContent {
  return {
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.occlusion_data ?? null,
    tags: card.tags ?? [],
    sort_order: card.sort_order,
  };
}

function cardInsert(jobId: string, card: PublicationCardContent): CardInsert {
  // The id is chosen here so each new card can be linked to its published card.
  return { id: crypto.randomUUID(), job_id: jobId, ...cardFields(card) };
}

/** What a card says, ignoring its tags and position. Two cards with one key are the same card. */
function contentKey(card: Pick<PublicationCardContent, "type" | "front" | "back" | "cloze_text" | "extra">): string {
  return JSON.stringify([card.type, card.front ?? "", card.back ?? "", card.cloze_text ?? "", card.extra ?? ""]);
}

function sameCard(a: PublicationCardContent, b: PublicationCardContent): boolean {
  return (
    contentKey(a) === contentKey(b) &&
    a.sort_order === b.sort_order &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? []) &&
    JSON.stringify(a.occlusion_data ?? null) === JSON.stringify(b.occlusion_data ?? null)
  );
}

export async function createProjectFromCards(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  cards: IncomingCard[],
): Promise<{ projectId: string; jobId: string; links: CardLink[] }> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: title,
      deck_name: title,
      settings: { cardMix: "basic", detailLevel: "medium" },
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to create project");
  }

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .insert({
      project_id: project.id,
      type: "text",
      raw_text: "Imported from DeepHaus Community",
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(sourceError?.message ?? "Failed to create source");
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      source_id: source.id,
      status: "ready",
      progress: 100,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Failed to create generation job");
  }

  const links: CardLink[] = [];
  const rows = cards.map((card) => {
    const row = cardInsert(job.id, card);
    if (card.source_card_id) links.push({ source_card_id: card.source_card_id, local_card_id: row.id });
    return row;
  });
  for (const batch of chunk(rows, 500)) {
    const { error: cardsError } = await supabase.from("cards").insert(batch);
    if (cardsError) throw new Error(cardsError.message);
  }

  return { projectId: project.id, jobId: job.id, links };
}

export type CardLink = { source_card_id: string; local_card_id: string };

/** Remember which local card came from which published card. Skipped until the table exists. */
export async function saveCardLinks(
  supabase: SupabaseClient,
  subscriptionId: string,
  links: CardLink[],
): Promise<void> {
  for (const batch of chunk(links, 500)) {
    const { error } = await supabase
      .from("deck_subscription_cards")
      .upsert(
        batch.map((link) => ({ subscription_id: subscriptionId, ...link })),
        { onConflict: "subscription_id,source_card_id" },
      );
    if (error) {
      if (isMissingSchema(error)) return;
      throw new Error(error.message);
    }
  }
}

async function loadCardLinks(supabase: SupabaseClient, subscriptionId: string): Promise<CardLink[]> {
  try {
    return await fetchAllRows<CardLink>((from, to) =>
      supabase
        .from("deck_subscription_cards")
        .select("source_card_id, local_card_id")
        .eq("subscription_id", subscriptionId)
        .order("source_card_id", { ascending: true })
        .range(from, to),
    );
  } catch {
    // The table arrives with a migration; until then every update matches by content.
    return [];
  }
}

type LocalCard = PublicationCardContent & { id: string; job_id: string };

export type SyncResult = { kept: number; updated: number; added: number; removed: number };

/**
 * Bring a learner's copy up to date with a new version of the published deck,
 * without throwing their progress away.
 *
 * Review history hangs off the card row, so a card that is still in the deck
 * must keep its row. Each published card is paired with a local one: by the
 * saved link when there is one, otherwise with a local card that says the same
 * thing. A paired card is updated in place. Published cards with no pair are
 * added, and local cards whose published card is gone are removed.
 *
 * Cards the learner added themselves are never linked, so they are left alone,
 * except in a copy made before links existed: there the deck's first job holds
 * only published cards and is treated as such, as the old replace-all sync did.
 */
export async function syncProjectCards(
  supabase: SupabaseClient,
  subscriptionId: string,
  projectId: string,
  incoming: IncomingCard[],
): Promise<SyncResult> {
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id, created_at, sources!inner(project_id)")
    .eq("sources.project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1);
  const importJobId = jobs?.[0]?.id as string | undefined;
  if (!importJobId) throw new Error("Project has no generation job");

  const [local, links] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("cards")
        .select(`id, job_id, ${PUBLICATION_CARD_COLUMNS}, generation_jobs!inner(sources!inner(project_id))`)
        .eq("generation_jobs.sources.project_id", projectId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    loadCardLinks(supabase, subscriptionId),
  ]);

  const localById = new Map<string, LocalCard>(
    local.map((row) => [
      row.id as string,
      { id: row.id as string, job_id: row.job_id as string, ...cardFields(row as unknown as PublicationCardContent) },
    ]),
  );
  const localBySource = new Map(
    links.filter((link) => localById.has(link.local_card_id)).map((link) => [link.source_card_id, link.local_card_id]),
  );
  const linkedLocalIds = new Set(localBySource.values());
  const hadLinks = localBySource.size > 0;

  // Unlinked cards in the import job, by what they say, for content matching.
  const byContent = new Map<string, string[]>();
  for (const card of localById.values()) {
    if (card.job_id !== importJobId || linkedLocalIds.has(card.id)) continue;
    const key = contentKey(card);
    byContent.set(key, [...(byContent.get(key) ?? []), card.id]);
  }

  const paired = new Set<string>();
  const updates: Array<{ id: string; card: PublicationCardContent }> = [];
  const inserts: CardInsert[] = [];
  const newLinks: CardLink[] = [];
  let kept = 0;

  for (const card of incoming) {
    const linkedId = card.source_card_id ? localBySource.get(card.source_card_id) : undefined;
    const matchedId = linkedId ?? byContent.get(contentKey(card))?.shift();

    if (matchedId) {
      paired.add(matchedId);
      if (sameCard(localById.get(matchedId)!, card)) kept += 1;
      else updates.push({ id: matchedId, card });
      if (!linkedId && card.source_card_id) {
        newLinks.push({ source_card_id: card.source_card_id, local_card_id: matchedId });
      }
      continue;
    }

    const row = cardInsert(importJobId, card);
    inserts.push(row);
    if (card.source_card_id) newLinks.push({ source_card_id: card.source_card_id, local_card_id: row.id });
  }

  const stale = [...localById.values()]
    .filter((card) => !paired.has(card.id))
    .filter((card) => linkedLocalIds.has(card.id) || (!hadLinks && card.job_id === importJobId))
    .map((card) => card.id);

  // Add and change before removing, so a failure part-way never leaves fewer cards than before.
  for (const batch of chunk(inserts, 500)) {
    const { error } = await supabase.from("cards").insert(batch);
    if (error) throw new Error(error.message);
  }
  for (const { id, card } of updates) {
    const { error } = await supabase.from("cards").update(cardFields(card)).eq("id", id);
    if (error) throw new Error(error.message);
  }
  await saveCardLinks(supabase, subscriptionId, newLinks);
  for (const batch of chunk(stale, 200)) {
    const { error } = await supabase.from("cards").delete().in("id", batch);
    if (error) throw new Error(error.message);
  }

  return { kept, updated: updates.length, added: inserts.length, removed: stale.length };
}
