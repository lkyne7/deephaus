import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user!.id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = await request.json();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user!.id,
      name: body.name,
      deck_name: body.deck_name,
      settings: body.settings ?? { cardMix: "both", density: 5 },
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
