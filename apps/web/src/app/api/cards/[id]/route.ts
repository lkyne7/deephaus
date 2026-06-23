import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { reconcileOcclusionStudyReviews } from "@/lib/occlusion/reconcile-reviews";
import { createClient } from "@/lib/supabase/server";

export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order, user_edited, generation_jobs!inner(sources!inner(projects!inner(id, user_id, name, deck_name)))",
    )
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const gj = Array.isArray(data.generation_jobs) ? data.generation_jobs[0] : data.generation_jobs;
  const src = Array.isArray(gj?.sources) ? gj.sources[0] : gj?.sources;
  const project = Array.isArray(src?.projects) ? src.projects[0] : src?.projects;

  const { data: review } = await supabase
    .from("card_reviews")
    .select("suspended")
    .eq("card_id", id)
    .eq("user_id", user!.id)
    .eq("cloze_ord", 0)
    .maybeSingle();

  return NextResponse.json({
    id: data.id,
    deck_id: project?.id ?? "",
    deck_name: project?.deck_name || project?.name || "",
    type: data.type,
    front: data.front,
    back: data.back,
    cloze_text: data.cloze_text,
    extra: data.extra,
    occlusion_data: data.occlusion_data ?? null,
    tags: data.tags ?? [],
    sort_order: data.sort_order,
    user_edited: data.user_edited,
    suspended: review?.suspended ?? false,
  });
}, "GET /api/cards/[id]");

export const PUT = withApiTiming(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const body = await request.json();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("cards")
    .select("id, type, occlusion_data, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (!existing) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const allowed: Record<string, unknown> = {};
  const cardTypes = ["basic", "cloze", "image-occlusion"] as const;
  if ("front" in body) allowed.front = body.front ?? null;
  if ("back" in body) allowed.back = body.back ?? null;
  if ("cloze_text" in body) allowed.cloze_text = body.cloze_text ?? null;
  if ("extra" in body) allowed.extra = body.extra ?? null;
  if (
    "type" in body &&
    typeof body.type === "string" &&
    (cardTypes as readonly string[]).includes(body.type)
  ) {
    allowed.type = body.type;
  }
  const nextType =
    typeof allowed.type === "string"
      ? allowed.type
      : (existing.type as (typeof cardTypes)[number]);
  if ("occlusion_data" in body) {
    const nextOcclusionData = body.occlusion_data ?? null;
    allowed.occlusion_data =
      nextOcclusionData === null &&
      nextType === "image-occlusion" &&
      existing.type === "image-occlusion" &&
      existing.occlusion_data != null
        ? existing.occlusion_data
        : nextOcclusionData;
  }
  if (nextType === "image-occlusion" || "cloze_text" in body) {
    allowed.cloze_text = nextType === "cloze" ? (body.cloze_text ?? null) : null;
  }
  if (nextType === "basic" || "extra" in body) {
    allowed.extra = nextType === "cloze" ? (body.extra ?? null) : null;
  }
  if (nextType !== "image-occlusion" && ("type" in allowed || "occlusion_data" in body)) {
    allowed.occlusion_data = null;
  }
  if ("tags" in body && Array.isArray(body.tags)) {
    allowed.tags = body.tags.filter((t: unknown) => typeof t === "string");
  }

  const { data, error } = await supabase
    .from("cards")
    .update({
      ...allowed,
      user_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (nextType === "image-occlusion" && data?.occlusion_data) {
    try {
      await reconcileOcclusionStudyReviews(supabase, id, user!.id, data.occlusion_data);
    } catch (reconcileErr) {
      console.error("[cards/PUT] reconcile occlusion reviews:", reconcileErr);
    }
  }

  return NextResponse.json(data);
}, "PUT /api/cards/[id]");

export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (!existing) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const { error } = await supabase.from("cards").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}, "DELETE /api/cards/[id]");
