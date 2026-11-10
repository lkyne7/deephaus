import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { examErrorResponse, parseJsonBody } from "@/lib/exams/http";
import { examActionSchema, updateExamSchema } from "@/lib/exams/schemas";
import { deleteExam, getExamDetail, runExamAction, updateExam } from "@/lib/exams/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

type RouteContext = { params: Promise<{ id: string }> };

async function examId(context: RouteContext) {
  return z.string().uuid().parse((await context.params).id);
}

export const GET = withApiTiming(async function GET(_request: Request, context: RouteContext) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(await getExamDetail(supabase, user!.id, await examId(context)));
  } catch (error) {
    return examErrorResponse(error);
  }
}, "GET /api/exams/[id]");

export const PATCH = withApiTiming(async function PATCH(request: Request, context: RouteContext) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const id = await examId(context);
    const body = await parseJsonBody(request);
    const action = examActionSchema.safeParse(body);
    if (action.success) {
      return NextResponse.json(await runExamAction(supabase, user!.id, id, action.data.action));
    }
    return NextResponse.json(
      await updateExam(supabase, user!.id, id, updateExamSchema.parse(body)),
    );
  } catch (error) {
    return examErrorResponse(error);
  }
}, "PATCH /api/exams/[id]");

export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    await deleteExam(supabase, user!.id, await examId(context));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return examErrorResponse(error);
  }
}, "DELETE /api/exams/[id]");
