import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  type CardReviewRow,
  buildScheduler,
  emptyCard,
  loadUserParams,
  previewIntervals,
  rowToCard,
} from "@/lib/fsrs/scheduler";
import { settingsFromRecord } from "@/lib/fsrs/settings";

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

  const settings = settingsFromRecord(project.settings);
  const clozeOrd = body.cloze_ord;

  if (body.log_action === "delete_latest") {
    const { data: latestLog, error: latestError } = await supabase
      .from("review_logs")
      .select("id")
      .eq("card_id", cardId)
      .eq("user_id", user!.id)
      .eq("cloze_ord", clozeOrd)
      .order("review", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      return NextResponse.json({ error: latestError.message }, { status: 500 });
    }
    if (!latestLog) {
      return NextResponse.json({ error: "No review log to undo" }, { status: 409 });
    }

    const { error: deleteLogError } = await supabase
      .from("review_logs")
      .delete()
      .eq("id", latestLog.id);
    if (deleteLogError) {
      return NextResponse.json({ error: deleteLogError.message }, { status: 500 });
    }
  }

  if (body.review_state == null) {
    const { error: deleteReviewError } = await supabase
      .from("card_reviews")
      .delete()
      .eq("card_id", cardId)
      .eq("user_id", user!.id)
      .eq("cloze_ord", clozeOrd);
    if (deleteReviewError) {
      return NextResponse.json({ error: deleteReviewError.message }, { status: 500 });
    }
  } else {
    const { error: upsertError } = await supabase
      .from("card_reviews")
      .upsert(
        {
          card_id: cardId,
          user_id: user!.id,
          cloze_ord: clozeOrd,
          ...body.review_state,
        },
        { onConflict: "card_id,user_id,cloze_ord" },
      );
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  if (body.log_action === "insert" && body.log) {
    const { error: insertLogError } = await supabase.from("review_logs").insert({
      card_id: cardId,
      user_id: user!.id,
      cloze_ord: clozeOrd,
      ...body.log,
    });
    if (insertLogError) {
      return NextResponse.json({ error: insertLogError.message }, { status: 500 });
    }
  }

  const userParams = await loadUserParams(supabase, user!.id);
  const scheduler = buildScheduler({
    w: userParams,
    requestRetention: settings.desiredRetention,
  });

  const fsrsCard = body.review_state
    ? rowToCard(body.review_state as CardReviewRow)
    : emptyCard(new Date());

  return NextResponse.json({
    state: fsrsCard.state as number,
    due: fsrsCard.due.toISOString(),
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    is_new: body.review_state == null || body.review_state.state === 0,
    intervals: previewIntervals(scheduler, fsrsCard, new Date()),
  });
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
