import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse, parseJsonBody } from "@/lib/cram/http";
import {
  cramPlanActionSchema,
  updateCramPlanSettingsSchema,
} from "@/lib/cram/schemas";
import {
  deleteDraftCramPlan,
  getCramPlanDetail,
  transitionCramPlan,
  updateDraftCramPlan,
} from "@/lib/cram/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

type RouteContext = { params: Promise<{ id: string }> };

async function planId(context: RouteContext) {
  return z.string().uuid().parse((await context.params).id);
}

export const GET = withApiTiming(async function GET(
  _request: Request,
  context: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(
      await getCramPlanDetail(supabase, user!.id, await planId(context)),
    );
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "GET /api/cram-plans/[id]");

export const PATCH = withApiTiming(async function PATCH(
  request: Request,
  context: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const id = await planId(context);
    const body = await parseJsonBody(request);
    const action = cramPlanActionSchema.safeParse(body);
    const result = action.success
      ? await transitionCramPlan(supabase, user!.id, id, action.data.action)
      : await updateDraftCramPlan(
          supabase,
          user!.id,
          id,
          updateCramPlanSettingsSchema.parse(body),
        );
    return NextResponse.json(result);
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "PATCH /api/cram-plans/[id]");

export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    await deleteDraftCramPlan(supabase, user!.id, await planId(context));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "DELETE /api/cram-plans/[id]");
