import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { publishProject, unpublishProject } from "@/lib/community/publish";

const publishSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("source_project_id", projectId)
    .eq("publisher_id", user!.id)
    .maybeSingle();

  return NextResponse.json(data ?? null);
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const parsed = publishSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    const publication = await publishProject(supabase, user!.id, parsed.data.project_id, {
      title: parsed.data.title,
      description: parsed.data.description,
    });
    return NextResponse.json(publication, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    await unpublishProject(supabase, user!.id, projectId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unpublish failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
