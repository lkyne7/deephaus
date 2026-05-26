import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDeckCounts } from "@/lib/fsrs/stats";

/**
 * Lightweight queue counts for a single deck — used by the deck page badge
 * and refreshed by the study UI after rating cards.
 *
 *   GET /api/decks/{deckId}/stats
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const counts = await getDeckCounts(supabase, id, user!.id);
  return NextResponse.json(counts);
}
