import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { examErrorResponse } from "@/lib/exams/http";
import { loadExamSelectorOptions } from "@/lib/exams/options";
import { withApiTiming } from "@/lib/perf/with-api-timing";

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(await loadExamSelectorOptions(supabase, user!.id));
  } catch (error) {
    return examErrorResponse(error);
  }
}, "GET /api/exams/options");
