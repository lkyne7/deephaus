import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectFromCards, saveCardLinks, syncProjectCards, type IncomingCard } from "./clone";
import { fetchAllRows } from "./db";
import type { PublicationCard, PublicationFacts, SyncMode } from "./types";

export const PREVIEW_LIMIT = 8;
export const PREVIEW_MAX = 50;

export async function loadPublicationPreview(
  supabase: SupabaseClient,
  publicationId: string,
  page: { offset?: number; limit?: number } = {},
) {
  const { data: publication, error } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("id", publicationId)
    .single();

  if (error || !publication) throw new Error("Deck not found");

  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const limit = Math.min(PREVIEW_MAX, Math.max(1, Math.floor(page.limit ?? PREVIEW_LIMIT)));
  const { data: cards } = await supabase
    .from("publication_cards")
    .select("*")
    .eq("publication_id", publicationId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  return {
    publication,
    previewCards: (cards ?? []) as PublicationCard[],
  };
}

/** Cards per type and the most used tags. Null until the listing migration is applied. */
export async function loadPublicationFacts(
  supabase: SupabaseClient,
  publicationId: string,
): Promise<PublicationFacts | null> {
  const { data, error } = await supabase.rpc("publication_card_facts", {
    p_publication_id: publicationId,
    // More than are shown: page markers and repeats are dropped before display.
    p_tag_limit: 14,
  });
  if (error || !data) return null;
  const facts = data as { types?: Record<string, number>; tags?: string[] };
  return { types: facts.types ?? {}, tags: facts.tags ?? [] };
}

/** Every card of a publication, in deck order. */
async function loadPublicationCards(
  supabase: SupabaseClient,
  publicationId: string,
): Promise<IncomingCard[]> {
  return fetchAllRows<IncomingCard>((from, to) =>
    supabase
      .from("publication_cards")
      .select("*")
      .eq("publication_id", publicationId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** Add a published deck to the user's own decks, as a copy that follows updates or stands alone. */
export async function subscribeToPublication(
  supabase: SupabaseClient,
  userId: string,
  publicationId: string,
  syncMode: SyncMode,
) {
  const { data: publication, error: pubError } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("id", publicationId)
    .single();

  if (pubError || !publication) throw new Error("Deck not found");
  if (publication.publisher_id === userId) {
    throw new Error("This is your own deck");
  }

  const { data: existing } = await supabase
    .from("deck_subscriptions")
    .select("id")
    .eq("publication_id", publicationId)
    .eq("subscriber_id", userId)
    .maybeSingle();

  if (existing) throw new Error("Already in your decks");

  const pubCards = await loadPublicationCards(supabase, publicationId);
  if (pubCards.length === 0) throw new Error("This deck has no cards");

  const { projectId, links } = await createProjectFromCards(
    supabase,
    userId,
    publication.title,
    pubCards,
  );

  const { data: subscription, error: subError } = await supabase
    .from("deck_subscriptions")
    .insert({
      publication_id: publicationId,
      subscriber_id: userId,
      sync_mode: syncMode,
      local_project_id: projectId,
      publication_version: publication.version,
    })
    .select("*")
    .single();

  if (subError || !subscription) {
    await supabase.from("projects").delete().eq("id", projectId);
    throw new Error(subError?.message ?? "Could not add this deck");
  }

  // Links only matter for later updates; the deck is usable without them.
  await saveCardLinks(supabase, subscription.id as string, links).catch(() => undefined);

  return { subscription, localProjectId: projectId };
}

export async function unsubscribeFromPublication(
  supabase: SupabaseClient,
  userId: string,
  publicationId: string,
  opts: { deleteLocalProject?: boolean } = {},
) {
  const { data: subscription } = await supabase
    .from("deck_subscriptions")
    .select("id, sync_mode, local_project_id")
    .eq("publication_id", publicationId)
    .eq("subscriber_id", userId)
    .maybeSingle();

  if (!subscription) throw new Error("Not in your decks");

  const { error } = await supabase.from("deck_subscriptions").delete().eq("id", subscription.id);
  if (error) throw new Error(error.message);

  if (opts.deleteLocalProject && subscription.sync_mode === "follow") {
    await supabase.from("projects").delete().eq("id", subscription.local_project_id);
  }

  return { localProjectId: subscription.local_project_id, syncMode: subscription.sync_mode as SyncMode };
}

/** Stop following updates: the copy becomes the user's own and is never changed again. */
export async function convertSubscriptionToCopy(
  supabase: SupabaseClient,
  userId: string,
  publicationId: string,
): Promise<{ localProjectId: string; syncMode: SyncMode }> {
  const { data: subscription } = await supabase
    .from("deck_subscriptions")
    .select("id, local_project_id")
    .eq("publication_id", publicationId)
    .eq("subscriber_id", userId)
    .maybeSingle();

  if (!subscription) throw new Error("Not in your decks");

  const { error } = await supabase
    .from("deck_subscriptions")
    .update({ sync_mode: "fork", updated_at: new Date().toISOString() })
    .eq("id", subscription.id);
  if (error) throw new Error(error.message);

  return { localProjectId: subscription.local_project_id as string, syncMode: "fork" };
}

export async function syncFollowSubscriptionIfNeeded(
  supabase: SupabaseClient,
  localProjectId: string,
  userId: string,
): Promise<boolean> {
  const { data: subscription } = await supabase
    .from("deck_subscriptions")
    .select("id, sync_mode, publication_id, publication_version")
    .eq("local_project_id", localProjectId)
    .eq("subscriber_id", userId)
    .maybeSingle();

  if (!subscription || subscription.sync_mode !== "follow") return false;

  const { data: publication } = await supabase
    .from("deck_publications")
    .select("version")
    .eq("id", subscription.publication_id)
    .single();

  if (!publication || publication.version <= subscription.publication_version) return false;

  const pubCards = await loadPublicationCards(supabase, subscription.publication_id as string);
  // A republish rewrites the cards after bumping the version; never sync from the gap between.
  if (pubCards.length === 0) return false;

  await syncProjectCards(supabase, subscription.id as string, localProjectId, pubCards);

  await supabase
    .from("deck_subscriptions")
    .update({
      publication_version: publication.version,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);

  return true;
}
