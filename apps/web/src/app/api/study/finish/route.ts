import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonNoStore } from "@/lib/api/cache-headers";
import { requireAuth } from "@/lib/auth";
import { getStudyFinish } from "@/lib/study/finish";

/** Each deck's standing at the end of a session, for the finish page. Never cached. */
export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  try {
    return jsonNoStore(await getStudyFinish(supabase, user!.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load what's left to study";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/study/finish");
