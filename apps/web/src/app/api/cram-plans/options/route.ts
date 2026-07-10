import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse } from "@/lib/cram/http";
import { loadCramSelectorOptions } from "@/lib/cram/options";
import { withApiTiming } from "@/lib/perf/with-api-timing";

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(await loadCramSelectorOptions(supabase, user!.id));
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "GET /api/cram-plans/options");
