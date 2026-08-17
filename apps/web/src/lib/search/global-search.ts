import type { SupabaseClient } from "@supabase/supabase-js";
import { cardPreviewText, loadBrowseCards } from "@/lib/browse/cards";
import { loadCommunityDecks } from "@/lib/community/load-community-decks";

export type GlobalSearchKind = "deck" | "card" | "community";

export type GlobalSearchHit = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  cardType?: "basic" | "cloze" | "image-occlusion";
};

export type GlobalSearchTotals = Record<GlobalSearchKind, number>;

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchHit[];
  totals: GlobalSearchTotals;
};

const DEFAULT_PER_KIND = 4;

function ilikePattern(query: string): string {
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  return `%${escaped}%`;
}

function matchesNeedle(text: string | null | undefined, needle: string): boolean {
  return (text ?? "").toLowerCase().includes(needle);
}

export async function runGlobalSearch(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  perKind = DEFAULT_PER_KIND,
): Promise<GlobalSearchResponse> {
  const trimmed = query.trim();
  const emptyTotals: GlobalSearchTotals = { deck: 0, card: 0, community: 0 };
  if (!trimmed) {
    return { query: trimmed, results: [], totals: emptyTotals };
  }

  const needle = trimmed.toLowerCase();
  const pattern = ilikePattern(trimmed);

  const [projectsRes, cardsRes, communityAll] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, deck_name")
      .eq("user_id", userId)
      .or(`deck_name.ilike.${pattern},name.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(perKind + 1),
    loadBrowseCards(supabase, userId, { search: trimmed, limit: perKind + 1, offset: 0 }),
    loadCommunityDecks(supabase, userId),
  ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);

  const deckRows = projectsRes.data ?? [];
  const deckTotal = deckRows.length;
  const deckHits: GlobalSearchHit[] = deckRows.slice(0, perKind).map((project) => {
    const title = project.deck_name || project.name || "Untitled deck";
    return {
      kind: "deck",
      id: project.id,
      title,
      subtitle: "Deck",
      href: `/decks/${project.id}`,
    };
  });

  const cardTotal = cardsRes.total;
  const cardHits: GlobalSearchHit[] = cardsRes.cards.slice(0, perKind).map((card) => ({
    kind: "card",
    id: card.id,
    title: cardPreviewText(card) || "Empty card",
    subtitle: card.deck_name,
    href: `/cards?deck=${encodeURIComponent(card.deck_id)}&q=${encodeURIComponent(trimmed)}`,
    cardType: card.type,
  }));

  const communityRows = communityAll.filter(
    (deck) =>
      matchesNeedle(deck.title, needle) || matchesNeedle(deck.description, needle),
  );
  const communityTotal = communityRows.length;
  const communityHits: GlobalSearchHit[] = communityRows.slice(0, perKind).map((deck) => ({
    kind: "community",
    id: deck.id,
    title: deck.title,
    subtitle: deck.description?.trim() || `${deck.card_count} cards · Community`,
    href: `/community?q=${encodeURIComponent(deck.title)}`,
  }));

  const results = [...cardHits, ...deckHits, ...communityHits];

  return {
    query: trimmed,
    results,
    totals: {
      deck: deckTotal,
      card: cardTotal,
      community: communityTotal,
    },
  };
}
