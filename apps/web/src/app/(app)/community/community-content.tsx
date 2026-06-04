import { CommunityView } from "@/components/community-view";
import { loadCommunityDecks } from "@/lib/community/load-community-decks";
import { getAuthUser } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";

export async function CommunityContent() {
  const user = await getAuthUser();
  const supabase = await createClient();
  const decks = user ? await loadCommunityDecks(supabase, user.id) : [];

  return <CommunityView initialDecks={decks} />;
}
