import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  DeleteSourceError,
  deleteSourcePreservingCards,
} from "@/lib/sources/delete-source";

/**
 * DELETE /api/sources/:id — remove a source from a deck.
 *
 * Flashcards are kept; per-card source links (chunk / ref / quote) are cleared.
 */
export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  try {
    const result = await deleteSourcePreservingCards(supabase, id, user!.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DeleteSourceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Could not delete source.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "DELETE /api/sources/[id]");
