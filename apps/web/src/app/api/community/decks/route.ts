import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CommunityDeckRow } from "@/lib/community/types";

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const supabase = await createClient();

  let query = supabase
    .from("deck_publications")
    .select("*")
    .order("updated_at", { ascending: false });

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data: publications, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: subscriptions } = await supabase
    .from("deck_subscriptions")
    .select("publication_id, sync_mode")
    .eq("subscriber_id", user!.id);

  const subByPub = new Map(
    (subscriptions ?? []).map((s) => [s.publication_id, s.sync_mode as "follow" | "fork"]),
  );

  const rows: CommunityDeckRow[] = (publications ?? []).map((p) => ({
    ...(p as CommunityDeckRow),
    is_subscribed: subByPub.has(p.id),
    subscription_sync_mode: subByPub.get(p.id) ?? null,
    is_owner: p.publisher_id === user!.id,
  }));

  return NextResponse.json(rows);
}
