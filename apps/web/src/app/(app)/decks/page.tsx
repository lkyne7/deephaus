import { Suspense } from "react";
import { CardBrowseView } from "@/components/card-browse-view";
import { BrowsePageSkeleton } from "@/components/ui/skeleton-patterns";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, deck_name")
    .order("updated_at", { ascending: false });

  const decks = (projects ?? []).map((p) => ({
    id: p.id,
    name: p.deck_name || p.name,
  }));

  return (
    <Suspense fallback={<BrowsePageSkeleton />}>
      <CardBrowseView initialDecks={decks} />
    </Suspense>
  );
}
