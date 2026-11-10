import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateDeckJob } from "@/lib/cards/deck-job";
import { chunk } from "@/lib/community/db";

export class CardBatchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CardBatchError";
    this.status = status;
  }
}

export type MoveCardsResult = {
  moved: number;
  /** Cards that were already in the deck. */
  already_there: number;
  /** Cards left where they are because their images belong to their source. */
  kept_for_images: number;
};

type MovingCard = {
  id: string;
  job_id: string;
  sort_order: number;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
};

const TEXT_COLUMNS = "id, job_id, sort_order, front, back, cloze_text, extra, occlusion_data";

/**
 * Images a source brought with it live in that source's folder, which is
 * emptied when its deck is deleted. A card that shows one stays with the source.
 */
function usesSourceImages(card: MovingCard): boolean {
  return [card.front, card.back, card.cloze_text, card.extra, JSON.stringify(card.occlusion_data ?? "")]
    .some((text) => text?.includes("/source-media/"));
}

async function inChunks<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (const group of chunk(items, size)) await Promise.all(group.map(run));
}

/**
 * Move cards into another of the user's decks. `cardIds` must already be known
 * to belong to the user.
 *
 * A card belongs to a deck through its generation job, so a move re-points the
 * card at a job in the target deck. Review history hangs off the card and goes
 * with it. The card's link to a passage of its old source is cleared, because
 * the source stays behind.
 *
 * A deck that follows a Community deck is refused on either side: its next
 * update would remove cards moved in, and bring back cards moved out.
 */
export async function moveCards(
  supabase: SupabaseClient,
  userId: string,
  cardIds: string[],
  targetDeckId: string,
): Promise<MoveCardsResult> {
  const { data: target } = await supabase
    .from("projects")
    .select("id")
    .eq("id", targetDeckId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) throw new CardBatchError("Deck not found", 404);

  const cards: MovingCard[] = [];
  for (const ids of chunk(cardIds, 100)) {
    const { data, error } = await supabase.from("cards").select(TEXT_COLUMNS).in("id", ids);
    if (error) throw new CardBatchError(error.message, 500);
    cards.push(...((data ?? []) as MovingCard[]));
  }

  // Which deck each card is in now, through its job and source.
  const jobIds = [...new Set(cards.map((card) => card.job_id))];
  const deckByJob = new Map<string, string>();
  for (const ids of chunk(jobIds, 100)) {
    const { data: jobs, error: jobsError } = await supabase
      .from("generation_jobs")
      .select("id, source_id")
      .in("id", ids);
    if (jobsError) throw new CardBatchError(jobsError.message, 500);
    const sourceIds = [...new Set((jobs ?? []).map((job) => job.source_id as string))];
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("id, project_id")
      .in("id", sourceIds);
    if (sourcesError) throw new CardBatchError(sourcesError.message, 500);
    const deckBySource = new Map((sources ?? []).map((s) => [s.id as string, s.project_id as string]));
    for (const job of jobs ?? []) {
      const deckId = deckBySource.get(job.source_id as string);
      if (deckId) deckByJob.set(job.id as string, deckId);
    }
  }

  const elsewhere = cards.filter((card) => deckByJob.get(card.job_id) !== targetDeckId);
  const moving = elsewhere.filter((card) => !usesSourceImages(card));
  const result: MoveCardsResult = {
    moved: 0,
    already_there: cards.length - elsewhere.length,
    kept_for_images: elsewhere.length - moving.length,
  };
  if (moving.length === 0) return result;

  const decksInvolved = [...new Set([targetDeckId, ...moving.map((card) => deckByJob.get(card.job_id)!)])];
  const { data: following, error: followingError } = await supabase
    .from("deck_subscriptions")
    .select("local_project_id")
    .eq("sync_mode", "follow")
    .in("local_project_id", decksInvolved)
    .limit(1);
  if (followingError) throw new CardBatchError(followingError.message, 500);
  if ((following ?? []).length > 0) {
    throw new CardBatchError(
      (following![0]!.local_project_id as string) === targetDeckId
        ? "That deck follows a Community deck, so cards can't be moved into it. Stop following its updates first."
        : "Cards can't be moved out of a deck that follows a Community deck. Stop following its updates first.",
      409,
    );
  }

  const job = await findOrCreateDeckJob(supabase, targetDeckId);
  if ("error" in job) throw new CardBatchError(job.error, 500);

  // Moved cards go to the end of the deck, in the order they had.
  const { data: lastRow } = await supabase
    .from("cards")
    .select("sort_order, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", targetDeckId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastOrder = (lastRow as { sort_order?: number } | null)?.sort_order ?? -1;
  const ordered = [...moving].sort(
    (a, b) =>
      (deckByJob.get(a.job_id) ?? "").localeCompare(deckByJob.get(b.job_id) ?? "") ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id),
  );

  const now = new Date().toISOString();
  const failures: string[] = [];
  await inChunks(
    ordered.map((card, index) => ({ card, sortOrder: lastOrder + 1 + index })),
    10,
    async ({ card, sortOrder }) => {
      const { error } = await supabase
        .from("cards")
        .update({
          job_id: job.jobId,
          sort_order: sortOrder,
          source_chunk_id: null,
          source_ref: null,
          source_quote: null,
          updated_at: now,
        })
        .eq("id", card.id);
      if (error) failures.push(error.message);
      else result.moved += 1;
    },
  );
  if (failures.length > 0 && result.moved === 0) throw new CardBatchError(failures[0]!, 500);

  await supabase.from("projects").update({ updated_at: now }).eq("id", targetDeckId).eq("user_id", userId);
  return result;
}

/** One tag as it is stored: trimmed, never empty, and without the comma that separates tags. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return tag && tag.length <= 80 ? tag : null;
}

/**
 * Add a tag to cards, or take it off them. `cardIds` must already be known to
 * belong to the user. Cards that already have (or lack) the tag are untouched.
 */
export async function tagCards(
  supabase: SupabaseClient,
  cardIds: string[],
  rawTag: string,
  mode: "tag" | "untag",
): Promise<{ updated: number; tag: string }> {
  const tag = normalizeTag(rawTag);
  if (!tag) throw new CardBatchError("Enter a tag of up to 80 characters.", 400);

  const rows: Array<{ id: string; tags: string[] | null }> = [];
  for (const ids of chunk(cardIds, 100)) {
    const { data, error } = await supabase.from("cards").select("id, tags").in("id", ids);
    if (error) throw new CardBatchError(error.message, 500);
    rows.push(...((data ?? []) as Array<{ id: string; tags: string[] | null }>));
  }

  // Cards that end up with the same tags share one update.
  const groups = new Map<string, { tags: string[]; ids: string[] }>();
  for (const row of rows) {
    const current = row.tags ?? [];
    const has = current.includes(tag);
    if (mode === "tag" ? has : !has) continue;
    const next = mode === "tag" ? [...current, tag] : current.filter((value) => value !== tag);
    const key = JSON.stringify(next);
    const group = groups.get(key) ?? { tags: next, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  const now = new Date().toISOString();
  let updated = 0;
  for (const group of groups.values()) {
    for (const ids of chunk(group.ids, 100)) {
      const { error } = await supabase
        .from("cards")
        .update({ tags: group.tags, user_edited: true, updated_at: now })
        .in("id", ids);
      if (error) throw new CardBatchError(error.message, 500);
      updated += ids.length;
    }
  }
  return { updated, tag };
}
