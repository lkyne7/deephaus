import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (!existing) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("cards")
    .update({
      ...body,
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
