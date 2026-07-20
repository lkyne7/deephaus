import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_extraction_jobs")
    .select(
      "id, status, phase, progress, pages_total, pages_completed, quality_score, error, updated_at",
    )
    .eq("source_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Extraction job not found." }, { status: 404 });
  }
  return NextResponse.json(data);
}
