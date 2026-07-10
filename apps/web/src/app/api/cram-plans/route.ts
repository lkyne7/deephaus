import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse, parseJsonBody } from "@/lib/cram/http";
import { createCramPlanSchema } from "@/lib/cram/schemas";
import { createCramPlan, listCramPlans } from "@/lib/cram/service";
import { CRAM_PLAN_STATUSES } from "@/lib/cram/types";
import { withApiTiming } from "@/lib/perf/with-api-timing";

const statusSchema = z.enum(CRAM_PLAN_STATUSES);

export const GET = withApiTiming(async function GET(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  try {
    const rawStatus = new URL(request.url).searchParams.get("status");
    const status = rawStatus ? statusSchema.parse(rawStatus) : undefined;
    const plans = await listCramPlans(supabase, user!.id, status);
    return NextResponse.json({ plans });
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "GET /api/cram-plans");

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  try {
    const input = createCramPlanSchema.parse(await parseJsonBody(request));
    const result = await createCramPlan(supabase, user!.id, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "POST /api/cram-plans");
