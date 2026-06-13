import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user!.id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}, "GET /api/projects");

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  const body = await request.json();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user!.id,
      name: body.name,
      deck_name: body.deck_name,
      settings: body.settings ?? { cardMix: "basic", detailLevel: "medium" },
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}, "POST /api/projects");
