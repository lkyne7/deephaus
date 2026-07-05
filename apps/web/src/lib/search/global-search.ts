import type { SourceType } from "@deephaus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardPreviewText, loadBrowseCards } from "@/lib/browse/cards";
import { loadCommunityDecks } from "@/lib/community/load-community-decks";
import { sourceTypeLabel } from "@/lib/sources/file-types";

export type GlobalSearchKind = "deck" | "card" | "note" | "community";

export type GlobalSearchHit = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  cardType?: "basic" | "cloze" | "image-occlusion";
  sourceType?: SourceType;
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

type SourceNoteRow = {
  id: string;
  type: SourceType;
  title: string | null;
  project_id: string;
  projects: { name: string | null; deck_name: string | null } | { name: string | null; deck_name: string | null }[];
};

function projectOf(row: SourceNoteRow) {
  if (Array.isArray(row.projects)) return row.projects[0] ?? null;
  return row.projects ?? null;
}

export async function runGlobalSearch(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  perKind = DEFAULT_PER_KIND,
): Promise<GlobalSearchResponse> {
  const trimmed = query.trim();
  const emptyTotals: GlobalSearchTotals = { deck: 0, card: 0, note: 0, community: 0 };
  if (!trimmed) {
    return { query: trimmed, results: [], totals: emptyTotals };
  }

  const needle = trimmed.toLowerCase();
  const pattern = ilikePattern(trimmed);

  const [projectsRes, cardsRes, sourcesRes, communityAll] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, deck_name")
      .eq("user_id", userId)
      .or(`deck_name.ilike.${pattern},name.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(perKind + 1),
    loadBrowseCards(supabase, userId, { search: trimmed, limit: perKind + 1, offset: 0 }),
    supabase
      .from("sources")
      .select("id, type, title, project_id, projects!inner(user_id, name, deck_name)")
      .eq("projects.user_id", userId)
      .not("type", "in", "(topic,apkg)")
      .order("created_at", { ascending: false })
      .limit(200),
    loadCommunityDecks(supabase, userId),
  ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);

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
    href: `/decks?deck=${encodeURIComponent(card.deck_id)}&q=${encodeURIComponent(trimmed)}`,
    cardType: card.type,
  }));

  const noteRows = ((sourcesRes.data ?? []) as unknown as SourceNoteRow[]).filter((row) => {
    const project = projectOf(row);
    const deckName = project?.deck_name ?? project?.name ?? "";
    const title = row.title?.trim() || `${deckName} · ${sourceTypeLabel(row.type)}`;
    return matchesNeedle(title, needle) || matchesNeedle(deckName, needle);
  });
  const noteTotal = noteRows.length;
  const noteHits: GlobalSearchHit[] = noteRows.slice(0, perKind).map((row) => {
    const project = projectOf(row);
    const deckName = project?.deck_name ?? project?.name ?? "Untitled deck";
    const title = row.title?.trim() || `${deckName} · ${sourceTypeLabel(row.type)}`;
    return {
      kind: "note",
      id: row.id,
      title,
      subtitle: deckName,
      href: `/notes/${row.id}`,
      sourceType: row.type,
    };
  });

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

  const results = [...cardHits, ...deckHits, ...noteHits, ...communityHits];

  return {
    query: trimmed,
    results,
    totals: {
      deck: deckTotal,
      card: cardTotal,
      note: noteTotal,
      community: communityTotal,
    },
  };
}
