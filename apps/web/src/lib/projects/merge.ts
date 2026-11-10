import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export class MergeProjectsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MergeProjectsError";
    this.status = status;
  }
}

export type MergeProjectsInput = {
  /** The deck that stays and receives everything. */
  keepId: string;
  /** The decks folded into it and then removed. */
  otherIds: string[];
  /** New name for the kept deck; unchanged when omitted. */
  name?: string;
};

export type MergeProjectsResult = {
  projectId: string;
  mergedCount: number;
};

/**
 * Fold several decks into one.
 *
 * A card belongs to a deck through `cards.job_id → generation_jobs.source_id →
 * sources.project_id`, and review history hangs off the card, so moving the
 * sources moves the cards and their progress with them.
 *
 * There is no transaction here, so the order is what keeps it safe: sources
 * move first, and a deck is only removed once it holds no sources. A failure
 * part-way leaves a deck that is partly merged, never cards that are gone, and
 * running the merge again finishes the job.
 *
 * The emptied decks are deleted without `deleteProject`'s storage sweep: the
 * moved sources still point at files under the old deck's folder.
 */
export async function mergeProjects(
  supabase: SupabaseClient,
  userId: string,
  input: MergeProjectsInput,
): Promise<MergeProjectsResult> {
  const otherIds = [...new Set(input.otherIds)].filter((id) => id !== input.keepId);
  if (otherIds.length === 0) {
    throw new MergeProjectsError("Pick at least two decks to merge.", 400);
  }
  const allIds = [input.keepId, ...otherIds];

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .in("id", allIds);
  if (projectsError) throw new MergeProjectsError(projectsError.message, 500);
  if ((projects ?? []).length !== allIds.length) {
    throw new MergeProjectsError("Deck not found", 404);
  }

  // A published deck would lose its listing, and a deck that follows a
  // publication has its cards replaced on the next update.
  const [{ data: publications, error: publicationsError }, { data: subscriptions, error: subscriptionsError }] =
    await Promise.all([
      supabase.from("deck_publications").select("id").in("source_project_id", allIds).limit(1),
      supabase.from("deck_subscriptions").select("id").in("local_project_id", allIds).limit(1),
    ]);
  if (publicationsError) throw new MergeProjectsError(publicationsError.message, 500);
  if (subscriptionsError) throw new MergeProjectsError(subscriptionsError.message, 500);
  if ((publications ?? []).length > 0 || (subscriptions ?? []).length > 0) {
    throw new MergeProjectsError(
      "Published decks and decks from Community can't be merged.",
      409,
    );
  }

  const { error: moveError } = await supabase
    .from("sources")
    .update({ project_id: input.keepId })
    .eq("user_id", userId)
    .in("project_id", otherIds);
  if (moveError) throw new MergeProjectsError(moveError.message, 500);

  await repointCramPlans(supabase, userId, input.keepId, otherIds);

  const { count: leftBehind, error: countError } = await supabase
    .from("sources")
    .select("id", { count: "exact", head: true })
    .in("project_id", otherIds);
  if (countError) throw new MergeProjectsError(countError.message, 500);
  if ((leftBehind ?? 0) > 0) {
    throw new MergeProjectsError("Some sources could not be moved. Nothing was deleted.", 500);
  }

  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("user_id", userId)
    .in("id", otherIds);
  if (deleteError) throw new MergeProjectsError(deleteError.message, 500);

  const name = input.name?.trim();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name) {
    update.name = name;
    update.deck_name = name;
  }
  const { error: renameError } = await supabase
    .from("projects")
    .update(update)
    .eq("id", input.keepId)
    .eq("user_id", userId);
  if (renameError) throw new MergeProjectsError(renameError.message, 500);

  return { projectId: input.keepId, mergedCount: otherIds.length };
}

/**
 * Keep cram plans pointing at the kept deck. Best-effort: a plan that can't be
 * updated only loses the merged decks' items when those decks are deleted,
 * which is what deleting a deck already does.
 */
async function repointCramPlans(
  supabase: SupabaseClient,
  userId: string,
  keepId: string,
  otherIds: string[],
): Promise<void> {
  try {
    await supabase.from("cram_plan_items").update({ project_id: keepId }).in("project_id", otherIds);

    const { data: plans } = await supabase
      .from("cram_plans")
      .select("id, selection_spec")
      .eq("user_id", userId);
    const merged = new Set(otherIds);
    for (const plan of plans ?? []) {
      const spec = (plan.selection_spec ?? {}) as { deck_ids?: unknown };
      if (!Array.isArray(spec.deck_ids)) continue;
      const deckIds = spec.deck_ids as string[];
      if (!deckIds.some((id) => merged.has(id))) continue;
      const next = [...new Set(deckIds.map((id) => (merged.has(id) ? keepId : id)))];
      await supabase
        .from("cram_plans")
        .update({ selection_spec: { ...spec, deck_ids: next } })
        .eq("id", plan.id);
    }
  } catch (error) {
    console.warn("[merge decks] could not repoint cram plans", error);
  }
}
