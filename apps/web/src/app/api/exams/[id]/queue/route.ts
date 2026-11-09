import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { examErrorResponse } from "@/lib/exams/http";
import { getExamQueue } from "@/lib/exams/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = withApiTiming(async function GET(request: Request, { params }: RouteContext) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const id = z.string().uuid().parse((await params).id);
    const query = querySchema.parse({
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });
    return NextResponse.json(await getExamQueue(supabase, user!.id, id, query));
  } catch (error) {
    return examErrorResponse(error);
  }
}, "GET /api/exams/[id]/queue");
