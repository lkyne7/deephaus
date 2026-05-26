import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectFromCards, replaceProjectCards } from "./clone";
import type { PublicationCard, SyncMode } from "./types";

const PREVIEW_LIMIT = 8;

export async function loadPublicationPreview(
  supabase: SupabaseClient,
  publicationId: string,
) {
  const { data: publication, error } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("id", publicationId)
    .single();

  if (error || !publication) throw new Error("Deck not found");

  const { data: cards } = await supabase
    .from("publication_cards")
    .select("*")
    .eq("publication_id", publicationId)
    .order("sort_order", { ascending: true })
    .limit(PREVIEW_LIMIT);

  return {
    publication,
    previewCards: (cards ?? []) as PublicationCard[],
  };
}

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
    throw new Error("You cannot subscribe to your own deck");
  }

  const { data: existing } = await supabase
    .from("deck_subscriptions")
    .select("id")
    .eq("publication_id", publicationId)
    .eq("subscriber_id", userId)
    .maybeSingle();

  if (existing) throw new Error("Already subscribed");

  const { data: pubCards, error: cardsError } = await supabase
    .from("publication_cards")
    .select("type, front, back, cloze_text, extra, tags, sort_order")
    .eq("publication_id", publicationId)
    .order("sort_order", { ascending: true });

  if (cardsError) throw new Error(cardsError.message);
  if (!pubCards?.length) throw new Error("This deck has no cards");

  const { projectId } = await createProjectFromCards(
    supabase,
    userId,
    publication.title,
    pubCards as PublicationCard[],
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
    throw new Error(subError?.message ?? "Subscribe failed");
  }

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

  if (!subscription) throw new Error("Not subscribed");

  const { error } = await supabase.from("deck_subscriptions").delete().eq("id", subscription.id);
  if (error) throw new Error(error.message);

  if (opts.deleteLocalProject && subscription.sync_mode === "follow") {
    await supabase.from("projects").delete().eq("id", subscription.local_project_id);
  }

  return { localProjectId: subscription.local_project_id, syncMode: subscription.sync_mode as SyncMode };
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

  const { data: pubCards } = await supabase
    .from("publication_cards")
    .select("type, front, back, cloze_text, extra, tags, sort_order")
    .eq("publication_id", subscription.publication_id)
    .order("sort_order", { ascending: true });

  if (!pubCards?.length) return false;

  await replaceProjectCards(supabase, localProjectId, pubCards as PublicationCard[]);

  await supabase
    .from("deck_subscriptions")
    .update({
      publication_version: publication.version,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);

  return true;
}
