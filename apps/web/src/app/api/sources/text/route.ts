import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = await request.json();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: body.project_id,
      type: "text",
      raw_text: body.text,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}, "POST /api/sources/text");
