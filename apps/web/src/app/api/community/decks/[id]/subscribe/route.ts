import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { createClient } from "@/lib/supabase/server";
import {
  convertSubscriptionToCopy,
  subscribeToPublication,
  unsubscribeFromPublication,
} from "@/lib/community/subscribe";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  sync_mode: z.enum(["follow", "fork"]),
});

/** Add a published deck to the user's decks, following updates or as a personal copy. */
export const POST = withApiTiming(async function POST(request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "sync_mode must be follow or fork" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    const result = await subscribeToPublication(
      supabase,
      user!.id,
      id,
      parsed.data.sync_mode,
    );
    // The new deck belongs in the Decks list and Home's totals straight away.
    invalidateUserStudyCaches(user!.id);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add this deck";
    const status = message.includes("Already") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}, "POST /api/community/decks/[id]/subscribe");

const patchSchema = z.object({ sync_mode: z.literal("fork") });

/** Stop following updates: the copy becomes the user's own. One way only. */
export const PATCH = withApiTiming(async function PATCH(request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "sync_mode must be fork" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    return NextResponse.json(await convertSubscriptionToCopy(supabase, user!.id, id));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update this deck";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "PATCH /api/community/decks/[id]/subscribe");

/** Detach the user's copy from the published deck. The copy stays in their decks. */
export const DELETE = withApiTiming(async function DELETE(_request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const supabase = await createClient();

  try {
    const result = await unsubscribeFromPublication(supabase, user!.id, id);
    invalidateUserStudyCaches(user!.id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not remove this deck";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "DELETE /api/community/decks/[id]/subscribe");
