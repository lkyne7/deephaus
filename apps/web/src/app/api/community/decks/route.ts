import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonWithPrivateCache } from "@/lib/api/cache-headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCommunityDecks } from "@/lib/community/load-community-decks";

export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const supabase = await createClient();
  let rows = await loadCommunityDecks(supabase, user!.id);

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((d) => d.title.toLowerCase().includes(needle));
  }

  return jsonWithPrivateCache(rows);
}, "GET /api/community/decks");
