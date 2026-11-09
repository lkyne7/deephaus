import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { examErrorResponse, parseJsonBody } from "@/lib/exams/http";
import { previewExamSchema } from "@/lib/exams/schemas";
import { previewExam } from "@/lib/exams/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

/** What an exam would ask for and reach, computed without saving anything. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const input = previewExamSchema.parse(await parseJsonBody(request));
    return NextResponse.json(await previewExam(supabase, user!.id, input));
  } catch (error) {
    return examErrorResponse(error);
  }
}, "POST /api/exams/preview");
