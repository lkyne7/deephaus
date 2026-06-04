import { occlusionCardPreviewText, stripCardMedia } from "@deephaus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BrowseCardRow = {
  id: string;
  deck_id: string;
  deck_name: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
  suspended: boolean;
  occlusion_data?: unknown;
};

export type BrowseFilters = {
  decks: Array<{ id: string; name: string }>;
  tags: string[];
};

export type BrowseResult = {
  cards: BrowseCardRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function loadBrowseFilters(
  supabase: SupabaseClient,
  userId: string,
  deckId?: string | null,
): Promise<BrowseFilters> {
  const [{ data: projects }, { data: tagRows, error: tagError }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, deck_name")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("browse_card_tags", {
      p_user_id: userId,
      p_deck_id: deckId ?? null,
    }),
  ]);

  if (tagError) {
    console.error("[browse] browse_card_tags failed:", tagError.message);
  }

  return {
    decks: (projects ?? []).map((p) => ({
      id: p.id,
      name: p.deck_name || p.name,
    })),
    tags: ((tagRows ?? []) as { tag: string }[]).map((r) => r.tag),
  };
}

export async function loadBrowseCards(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    deckId?: string | null;
    tag?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<BrowseResult> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const search = opts.search?.trim() || null;

  const { data, error } = await supabase.rpc("browse_cards", {
    p_user_id: userId,
    p_deck_id: opts.deckId ?? null,
    p_tag: opts.tag ?? null,
    p_search: search,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<BrowseCardRow & { total_count: number }>;
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    cards: rows.map(({ total_count: _total, ...card }) => card),
    total,
    limit,
    offset,
  };
}

export function cardPreviewText(card: Pick<BrowseCardRow, "type" | "front" | "cloze_text" | "back">) {
  if (card.type === "image-occlusion") {
    return occlusionCardPreviewText(card.front, card.back);
  }
  const raw =
    card.type === "cloze" && card.cloze_text ? card.cloze_text : (card.front ?? "");
  return stripCardMedia(raw);
}

/** Back side text: basic uses `back`, cloze uses `extra` (Anki back field). */
export function cardAnswerText(card: Pick<BrowseCardRow, "type" | "back" | "extra">) {
  const raw =
    card.type === "basic" ? (card.back ?? card.extra ?? "") : (card.extra ?? "");
  return stripCardMedia(raw);
}
