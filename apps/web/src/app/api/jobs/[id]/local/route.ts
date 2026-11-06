import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { LocalStepError, runLocalGenerationStep } from "@/lib/jobs/local-generation";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const bodySchema = z.object({
  position: z.number().int().min(0),
  outputs: z.array(z.string().max(1_000_000)).max(8).optional(),
  repeats: z.number().int().min(0).optional(),
  error: z.string().min(1).max(500).optional(),
});

/**
 * POST /api/jobs/:id/local — advance a job the desktop app runs on the user's
 * own plan: save the answers for one step and return the next step's prompts.
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(projects!inner(user_id))")
    .eq("id", id)
    .eq("sources.projects.user_id", user!.id)
    .single();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  try {
    return NextResponse.json(await runLocalGenerationStep(supabase, id, parsed.data));
  } catch (error) {
    if (error instanceof LocalStepError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}, "POST /api/jobs/[id]/local");
