import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse, parseJsonBody } from "@/lib/cram/http";
import { reviewCramItemSchema } from "@/lib/cram/schemas";
import { recordCramReview } from "@/lib/cram/service";
import { isValidGrade } from "@/lib/fsrs/scheduler";
import { withApiTiming } from "@/lib/perf/with-api-timing";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const id = z.string().uuid().parse((await params).id);
    const body = reviewCramItemSchema.parse(await parseJsonBody(request));
    if (!isValidGrade(body.rating)) {
      return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
    }
    return NextResponse.json(
      await recordCramReview(supabase, user!.id, id, {
        ...body,
        rating: body.rating,
      }),
    );
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "POST /api/cram-plans/[id]/review");
