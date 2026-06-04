import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Lightweight deck list (id + name) used to keep the sidebar nav fresh. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, deck_name")
    .eq("user_id", user!.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const decks = (data ?? []).map((d) => ({ id: d.id, name: d.deck_name || d.name }));
  return NextResponse.json({ decks });
}, "GET /api/decks");
