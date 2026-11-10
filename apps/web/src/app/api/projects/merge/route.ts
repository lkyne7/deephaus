import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { MergeProjectsError, mergeProjects } from "@/lib/projects/merge";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  keep_id: z.string().uuid(),
  other_ids: z.array(z.string().uuid()).min(1).max(50),
  name: z.string().trim().min(1).max(120).optional(),
});

/**
 *   POST /api/projects/merge
 *
 * Fold `other_ids` into `keep_id`: their sources, cards and review history
 * move across and the emptied decks are removed.
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  try {
    const result = await mergeProjects(supabase, user!.id, {
      keepId: body.keep_id,
      otherIds: body.other_ids,
      name: body.name,
    });
    return NextResponse.json({ id: result.projectId, merged: result.mergedCount });
  } catch (error) {
    if (error instanceof MergeProjectsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not merge decks.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // A merge that stopped part-way has still moved sources.
    invalidateUserStudyCaches(user!.id);
  }
}, "POST /api/projects/merge");
