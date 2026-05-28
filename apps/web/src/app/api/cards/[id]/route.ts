import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
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
      "id, type, front, back, cloze_text, extra, tags, sort_order, user_edited, generation_jobs!inner(sources!inner(projects!inner(id, user_id, name, deck_name)))",
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
    .select("id, type, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (!existing) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const allowed: Record<string, unknown> = {};
  if ("front" in body) allowed.front = body.front ?? null;
  if ("back" in body) allowed.back = body.back ?? null;
  if ("cloze_text" in body) allowed.cloze_text = body.cloze_text ?? null;
  if ("extra" in body) allowed.extra = body.extra ?? null;
  if (existing.type === "basic") {
    allowed.extra = null;
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
