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
  source_ref?: string | null;
  source_quote?: string | null;
};

export type BrowseFilters = {
  decks: Array<{ id: string; name: string }>;
  tags: string[];
};

export type BrowseCardState = "active" | "suspended";

const STATE_SCAN_CHUNK = 1000;

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

type BrowseQuery = {
  deckId?: string | null;
  tag?: string | null;
  search?: string | null;
};

async function fetchBrowsePage(
  supabase: SupabaseClient,
  userId: string,
  query: BrowseQuery,
  limit: number,
  offset: number,
): Promise<{ cards: BrowseCardRow[]; total: number }> {
  const { data, error } = await supabase.rpc("browse_cards", {
    p_user_id: userId,
    p_deck_id: query.deckId ?? null,
    p_tag: query.tag ?? null,
    p_search: query.search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<BrowseCardRow & { total_count: number }>;
  return {
    cards: rows.map(({ total_count: _total, ...card }) => card),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };
}

/**
 * browse_cards has no suspended argument, so a state filter walks the scoped
 * rows here to keep paging and the total exact. Cost grows with the scope; move
 * this into the RPC if large libraries make it slow.
 */
async function fetchBrowsePageByState(
  supabase: SupabaseClient,
  userId: string,
  query: BrowseQuery,
  state: BrowseCardState,
  limit: number,
  offset: number,
): Promise<{ cards: BrowseCardRow[]; total: number }> {
  const wanted = state === "suspended";
  const matches: BrowseCardRow[] = [];
  let scanned = 0;
  for (;;) {
    const page = await fetchBrowsePage(supabase, userId, query, STATE_SCAN_CHUNK, scanned);
    matches.push(...page.cards.filter((card) => card.suspended === wanted));
    scanned += page.cards.length;
    if (page.cards.length === 0 || scanned >= page.total) break;
  }
  return { cards: matches.slice(offset, offset + limit), total: matches.length };
}

export async function loadBrowseCards(
  supabase: SupabaseClient,
  userId: string,
  opts: BrowseQuery & {
    state?: BrowseCardState | null;
    limit?: number;
    offset?: number;
  },
): Promise<BrowseResult> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const { cards, total } = opts.state
    ? await fetchBrowsePageByState(supabase, userId, opts, opts.state, limit, offset)
    : await fetchBrowsePage(supabase, userId, opts, limit, offset);

  // The browse_cards RPC predates occlusion_data in its return type. Until the
  // migration adding it lands, hydrate regions for occlusion cards directly so
  // editors don't open generated cards with an empty region list.
  const missing = cards.filter(
    (c) => c.type === "image-occlusion" && c.occlusion_data === undefined,
  );
  if (missing.length > 0) {
    const { data: occRows } = await supabase
      .from("cards")
      .select("id, occlusion_data")
      .in("id", missing.map((c) => c.id));
    const byId = new Map((occRows ?? []).map((r) => [r.id, r.occlusion_data]));
    for (const card of cards) {
      if (byId.has(card.id)) card.occlusion_data = byId.get(card.id) ?? null;
    }
  }

  return { cards, total, limit, offset };
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
