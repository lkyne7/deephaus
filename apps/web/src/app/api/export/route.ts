import { NextResponse } from "next/server";
import { buildApkg, draftCardsToGenerated } from "@deephaus/apkg";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = await request.json();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("deck_name")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(projects!inner(user_id))")
    .eq("id", body.job_id)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data: cards, error } = await supabase
    .from("cards")
    .select("*")
    .eq("job_id", body.job_id)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cards?.length) {
    return NextResponse.json({ error: "No cards to export" }, { status: 400 });
  }

  const result = await buildApkg({
    deckName: project.deck_name,
    cards: draftCardsToGenerated(cards),
    description: "Exported from DeepHaus",
  });

  const filename = `${project.deck_name.replace(/[^a-z0-9-_]+/gi, "-")}.apkg`;
  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
