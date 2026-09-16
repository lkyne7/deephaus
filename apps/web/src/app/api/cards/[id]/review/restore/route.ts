import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {buildScheduler,emptyCard,rowToCard,previewIntervals,resolveDeckParams,loadUserParams,type CardReviewRow} from "@/lib/fsrs/scheduler";
import {loadDeckSettings} from "@/lib/fsrs/settings";

const reviewStateSchema = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.number().int().min(0).max(3),
  last_review: z.string().nullable(),
  learning_steps: z.number().int(),
});

const logSchema = z.object({
  rating: z.number().int().min(1).max(4),
  state: z.number().int().min(0).max(3),
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  last_elapsed_days: z.number(),
  scheduled_days: z.number(),
  review: z.string(),
});

const bodySchema = z.object({
  log_id: z.string().uuid(),
  cloze_ord: z.number().int().min(0).max(9).default(0),
  review_state: reviewStateSchema.nullable(),
  log_action: z.enum(["delete_latest", "insert"]),
  log: logSchema.optional(),
});

/**
 * Restore a card's FSRS review state (for study undo/redo).
 *
 *   POST /api/cards/{cardId}/review/restore
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: cardId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.log_action === "insert" && !body.log) {
    return NextResponse.json({ error: "log required for insert" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: cardRow } = await supabase
    .from("cards")
    .select(
      "id, generation_jobs!inner(sources!inner(projects!inner(id, user_id, settings)))",
    )
    .eq("id", cardId)
    .single();

  if (!cardRow) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const project = extractProject(cardRow);
  if (!project || project.user_id !== user!.id) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const clozeOrd = body.cloze_ord;

  const { data: restored, error: restoreError } = await supabase.rpc("restore_card_review", {
    p_card_id: cardId, p_cloze_ord: clozeOrd, p_log_id: body.log_id, p_undone: body.log_action === "delete_latest",
  });
  if (restoreError) return NextResponse.json({ error: restoreError.message }, { status: restoreError.code === "40001" ? 409 : 500 });
  invalidateUserStudyCaches(user!.id);
  const [current,settings,userParams]=await Promise.all([
    supabase.from("card_reviews").select("*").eq("card_id",cardId).eq("user_id",user!.id).eq("cloze_ord",clozeOrd).maybeSingle(),
    loadDeckSettings(supabase,project.id,user!.id),loadUserParams(supabase,user!.id),
  ]);
  if(current.error)return NextResponse.json({error:"Review was restored. Refresh the queue to reload its schedule."},{status:503});
  const now=new Date(),card=current.data?rowToCard(current.data as CardReviewRow):emptyCard(now);
  const scheduler=buildScheduler({w:resolveDeckParams(settings.fsrsParams,userParams),requestRetention:settings.desiredRetention});
  return NextResponse.json({...restored,state:card.state,due:card.due.toISOString(),reps:card.reps,lapses:card.lapses,is_new:card.state===0,intervals:previewIntervals(scheduler,card,now)});
}, "POST /api/cards/[id]/review/restore");

interface ProjectInfo {
  id: string;
  user_id: string;
  settings: unknown;
}

function extractProject(row: unknown): ProjectInfo | null {
  const r = row as {
    generation_jobs:
      | { sources: { projects: ProjectInfo | ProjectInfo[] } | { projects: ProjectInfo | ProjectInfo[] }[] }
      | { sources: { projects: ProjectInfo | ProjectInfo[] } | { projects: ProjectInfo | ProjectInfo[] }[] }[];
  };
  const gj = Array.isArray(r.generation_jobs) ? r.generation_jobs[0] : r.generation_jobs;
  if (!gj) return null;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  if (!src) return null;
  const proj = Array.isArray(src.projects) ? src.projects[0] : src.projects;
  return proj ?? null;
}
