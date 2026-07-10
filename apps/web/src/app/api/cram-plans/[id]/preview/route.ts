import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse } from "@/lib/cram/http";
import { previewCramPlanSchema } from "@/lib/cram/schemas";
import { previewCramPlan } from "@/lib/cram/service";
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
    const text = await request.text();
    const body = previewCramPlanSchema.parse(text ? JSON.parse(text) : {});
    return NextResponse.json(
      await previewCramPlan(supabase, user!.id, id, {
        deadline_at: body.deadline_at,
        deadline_timezone: body.deadline_timezone ?? body.timezone,
        target_retention: body.target_retention ?? body.desired_retention,
        daily_minutes: body.daily_minutes,
      }),
    );
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "POST /api/cram-plans/[id]/preview");
