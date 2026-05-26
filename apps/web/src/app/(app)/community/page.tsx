import { CommunityView } from "@/components/community-view";
import { createClient } from "@/lib/supabase/server";
import type { CommunityDeckRow } from "@/lib/community/types";

export const dynamic = "force-dynamic";

async function loadCommunityDecks(userId: string): Promise<CommunityDeckRow[]> {
  const supabase = await createClient();

  const { data: publications } = await supabase
    .from("deck_publications")
    .select("*")
    .order("updated_at", { ascending: false });

  if (!publications?.length) return [];

  const { data: subscriptions } = await supabase
    .from("deck_subscriptions")
    .select("publication_id, sync_mode")
    .eq("subscriber_id", userId);

  const subByPub = new Map(
    (subscriptions ?? []).map((s) => [s.publication_id, s.sync_mode as "follow" | "fork"]),
  );

  return publications.map((p) => ({
    ...(p as CommunityDeckRow),
    is_subscribed: subByPub.has(p.id),
    subscription_sync_mode: subByPub.get(p.id) ?? null,
    is_owner: p.publisher_id === userId,
  }));
}

export default async function CommunityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decks = user ? await loadCommunityDecks(user.id) : [];

  return (
    <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <CommunityView initialDecks={decks} />
    </div>
  );
}
