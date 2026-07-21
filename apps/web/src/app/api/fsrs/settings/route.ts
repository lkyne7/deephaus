import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FSRS_PARAM_COUNT, loadUserParams } from "@/lib/fsrs/scheduler";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";
import { getOptimizerReadiness } from "@/lib/fsrs/optimizer-readiness";
import {
  DEFAULT_GLOBAL_STUDY_SETTINGS,
  loadGlobalStudySettings,
  saveGlobalStudySettings,
} from "@/lib/fsrs/user-study-settings";

export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();
  const [global, userParams, readiness] = await Promise.all([
    loadGlobalStudySettings(supabase, user!.id),
    loadUserParams(supabase, user!.id),
    getOptimizerReadiness(supabase, user!.id),
  ]);

  const { data: paramsRow } = await supabase
    .from("user_fsrs_params")
    .select("optimized_at, log_count")
    .eq("user_id", user!.id)
    .maybeSingle();

  return NextResponse.json({
    ...global,
    hasOptimizedParams: Boolean(userParams && userParams.length === FSRS_PARAM_COUNT),
    lastOptimizedAt: paramsRow?.optimized_at ?? null,
    fsrsLogCount: readiness.totalLogs,
    usableItems: readiness.usableItems,
    optimizerMinLogs: OPTIMIZER_MIN_LOGS,
  });
}, "GET /api/fsrs/settings");

const patchSchema = z.object({
  desiredRetention: z.number().min(0.7).max(0.97).optional(),
  newCardsPerDay: z.number().int().min(0).max(200).optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).max(64).nullable().optional(),
});

export const PATCH = withApiTiming(async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    );
  }

  if (
    body.desiredRetention === undefined &&
    body.newCardsPerDay === undefined &&
    body.dayStartHour === undefined
  ) {
    return NextResponse.json({ error: "No settings to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const current = await loadGlobalStudySettings(supabase, user!.id);
  const next = {
    desiredRetention: body.desiredRetention ?? current.desiredRetention,
    newCardsPerDay: body.newCardsPerDay ?? current.newCardsPerDay,
    dayStartHour: body.dayStartHour ?? current.dayStartHour,
    timezone: body.timezone === undefined ? current.timezone : body.timezone,
  };

  await saveGlobalStudySettings(supabase, user!.id, next);

  return NextResponse.json({
    ...next,
    defaults: DEFAULT_GLOBAL_STUDY_SETTINGS,
  });
}, "PATCH /api/fsrs/settings");
