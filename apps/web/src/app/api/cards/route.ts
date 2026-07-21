import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireAuth } from "@/lib/auth";

const createCardSchema = z.object({
  project_id: z.string().uuid(),
  type: z.enum(["basic", "cloze", "image-occlusion"]).default("basic"),
  front: z.string().nullable().optional(),
  back: z.string().nullable().optional(),
  cloze_text: z.string().nullable().optional(),
  extra: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  source_id: z.string().uuid().optional(),
  source_chunk_id: z.string().uuid().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  source_quote: z.string().nullable().optional(),
  occlusion_data: z.unknown().optional(),
  /** When true, append after existing cards; otherwise inserts at the top. */
  append: z.boolean().optional(),
});

/**
 * POST /api/cards — create a card manually (or as a duplicate) on a deck. The
 * card is attached to the deck's most recent generation job so it shares the
 * project; a lightweight manual source/job is created if the deck has none.
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  let body: z.infer<typeof createCardSchema>;
  try {
    body = createCardSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    );
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  let requestedSourceId = body.source_id ?? null;
  if (requestedSourceId) {
    const { data: ownedSource } = await supabase
      .from("sources")
      .select("id")
      .eq("id", requestedSourceId)
      .eq("project_id", body.project_id)
      .single();
    if (!ownedSource) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
  }

  // Find (or create) a generation job to attach the card to. Source-scoped
  // creation preserves provenance instead of using another source's latest job.
  let jobQuery = supabase
    .from("generation_jobs")
    .select("id, sources!inner(project_id)");
  jobQuery = requestedSourceId
    ? jobQuery.eq("source_id", requestedSourceId)
    : jobQuery.eq("sources.project_id", body.project_id);
  const { data: jobRow } = await jobQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let jobId = (jobRow as { id?: string } | null)?.id ?? null;
  if (!jobId) {
    if (!requestedSourceId) {
      const { data: source, error: sourceError } = await supabase
        .from("sources")
        .insert({ project_id: body.project_id, type: "text", raw_text: "" })
        .select("id")
        .single();
      if (sourceError || !source) {
        return NextResponse.json({ error: sourceError?.message ?? "Could not create source" }, { status: 500 });
      }
      requestedSourceId = source.id;
    }
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .insert({ source_id: requestedSourceId, status: "ready", progress: 100 })
      .select("id")
      .single();
    if (jobError || !job) {
      return NextResponse.json({ error: jobError?.message ?? "Could not create job" }, { status: 500 });
    }
    jobId = job.id;
  }

  // Place the new card after existing cards in the deck.
  const { data: maxRow } = await supabase
    .from("cards")
    .select("sort_order, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", body.project_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseOrder = (maxRow as { sort_order?: number } | null)?.sort_order ?? -1;
  const sortOrder = body.append === false ? baseOrder - 1 : baseOrder + 1;

  const { data: card, error } = await supabase
    .from("cards")
    .insert({
      job_id: jobId,
      type: body.type,
      front: body.front ?? null,
      back: body.back ?? null,
      cloze_text: body.cloze_text ?? null,
      extra: body.extra ?? null,
      occlusion_data: body.occlusion_data ?? null,
      tags: body.tags ?? [],
      sort_order: sortOrder,
      user_edited: true,
      source_chunk_id: body.source_chunk_id ?? null,
      source_ref: body.source_ref ?? null,
      source_quote: body.source_quote ?? null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(card, { status: 201 });
}, "POST /api/cards");

export const GET = withApiTiming(async function GET(request: Request) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const jobId = new URL(request.url).searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(projects!inner(user_id))")
    .eq("id", jobId)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}, "GET /api/cards");
