import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { createClient } from "@/lib/supabase/server";
import {
  publishProject,
  unpublishProject,
  updatePublicationListing,
} from "@/lib/community/publish";
import { COMMUNITY_SUBJECT_VALUES } from "@/lib/community/subjects";

const subjectSchema = z.enum(COMMUNITY_SUBJECT_VALUES).nullable();

/** A field left out keeps its current value on a republish. */
const publishSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  subject: subjectSchema.optional(),
});

export const GET = withApiTiming(async function GET(request: Request) {
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
}, "GET /api/community/publish");

/** Publish a deck, or republish it: the cards are refreshed and the version goes up. */
export const POST = withApiTiming(async function POST(request: Request) {
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
      subject: parsed.data.subject,
    });
    // The Decks list shows which decks are published.
    invalidateUserStudyCaches(user!.id);
    return NextResponse.json(publication, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "POST /api/community/publish");

/** Edit the listing's title, description or subject without republishing the cards. */
export const PATCH = withApiTiming(async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const parsed = publishSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    const publication = await updatePublicationListing(supabase, user!.id, parsed.data.project_id, {
      title: parsed.data.title,
      description: parsed.data.description,
      subject: parsed.data.subject,
    });
    return NextResponse.json(publication);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the listing";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "PATCH /api/community/publish");

export const DELETE = withApiTiming(async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    await unpublishProject(supabase, user!.id, projectId);
    invalidateUserStudyCaches(user!.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unpublish failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "DELETE /api/community/publish");
