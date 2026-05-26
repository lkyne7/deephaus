import { Suspense } from "react";
import { CardBrowseView } from "@/components/card-browse-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function BrowseLoading() {
  return (
    <div style={{ padding: 24, color: "var(--fg-4)", font: "400 14px/20px var(--font-sans)" }}>
      Loading cards…
    </div>
  );
}

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
    <Suspense fallback={<BrowseLoading />}>
      <CardBrowseView initialDecks={decks} />
    </Suspense>
  );
}
