import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { examErrorResponse, parseJsonBody } from "@/lib/exams/http";
import { createExamSchema } from "@/lib/exams/schemas";
import { createExam, listExams } from "@/lib/exams/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(await listExams(supabase, user!.id));
  } catch (error) {
    return examErrorResponse(error);
  }
}, "GET /api/exams");

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const input = createExamSchema.parse(await parseJsonBody(request));
    return NextResponse.json(await createExam(supabase, user!.id, input), { status: 201 });
  } catch (error) {
    return examErrorResponse(error);
  }
}, "POST /api/exams");
