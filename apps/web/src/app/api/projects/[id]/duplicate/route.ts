import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import {
  DuplicateProjectError,
  duplicateProject,
} from "@/lib/projects/duplicate";
import { createClient } from "@/lib/supabase/server";

/**
 *   POST /api/projects/{id}/duplicate
 *
 * Copy cards and deck settings into a new project with fresh study progress.
 */
export const POST = withApiTiming(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  try {
    const project = await duplicateProject(supabase, id, user!.id);
    invalidateUserStudyCaches(user!.id);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateProjectError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Could not duplicate deck.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/projects/[id]/duplicate");
