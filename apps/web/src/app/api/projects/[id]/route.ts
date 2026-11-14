import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { cardMixSchema, detailLevelSchema, focusPresetSchema, qualityLevelSchema } from "@deephaus/shared";
import { requireAuth, requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { DeleteProjectError, deleteProject } from "@/lib/projects/delete";
import { createClient } from "@/lib/supabase/server";
import { mergeSettings } from "@/lib/fsrs/settings";
import { deckNameSchema, firstIssueMessage } from "@/lib/projects/deck-name";

export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (error) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  return NextResponse.json(data);
}, "GET /api/projects/[id]");

const patchSchema = z.object({
  name: deckNameSchema.optional(),
  deck_name: deckNameSchema.optional(),
  settings: z
    .object({
      desiredRetention: z.number().min(0.7).max(0.97).optional(),
      newCardsPerDay: z.number().int().min(0).max(200).optional(),
      useGlobalFsrsSettings: z.boolean().optional(),
      clearFsrsParams: z.boolean().optional(),
      // Create's generation controls, saved as they change so the deck keeps them.
      cardMix: cardMixSchema.optional(),
      cardTypes: z.array(cardMixSchema).min(1).optional(),
      detailLevel: detailLevelSchema.optional(),
      qualityLevel: qualityLevelSchema.optional(),
      focusPreset: focusPresetSchema.optional(),
      clozeHints: z.boolean().optional(),
      autoTags: z.boolean().optional(),
      paused: z.boolean().optional(),
      // Review order and limits; null clears the deck's review cap.
      spaceOutSiblings: z.boolean().optional(),
      newCardPosition: z.enum(["after", "mixed", "before"]).optional(),
      reviewSortOrder: z.enum(["due", "retrievability", "random"]).optional(),
      maxReviewsPerDay: z.number().int().min(0).max(9999).nullable().optional(),
    })
    .optional(),
});

/**
 *   PATCH /api/projects/{id}
 *
 * Update the deck's display name and/or its study settings. Settings are
 * merged into the existing `projects.settings` JSONB blob using the shared
 * generationSettingsSchema so we never wipe LLM-side fields like `density`.
 */
export const PATCH = withApiTiming(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireAuth({ patScope: "write" });
  if (response) return response;

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "Invalid deck update.") },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const { data: existing, error: fetchError } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.deck_name !== undefined) update.deck_name = body.deck_name;
  if (body.settings) update.settings = mergeSettings(existing.settings, body.settings);
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("projects")
    .update(update)
    .eq("id", id)
    .eq("user_id", user!.id)
    .select("*")
    .single();
  if (error) {
    console.error("[PATCH /api/projects/[id]]", error);
    return NextResponse.json({ error: "Could not update the deck." }, { status: 500 });
  }
  // The name and the paused flag both feed the cached deck lists and totals.
  invalidateUserStudyCaches(user!.id);
  return NextResponse.json(data);
}, "PATCH /api/projects/[id]");

/**
 *   DELETE /api/projects/{id}
 *
 * Permanently delete a deck owned by the caller. Cascades DB rows and
 * best-effort cleans storage + reserved AI credit holds.
 */
export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  try {
    await deleteProject(supabase, id, user!.id);
    invalidateUserStudyCaches(user!.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof DeleteProjectError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[DELETE /api/projects/[id]]", error);
    return NextResponse.json({ error: "Could not delete deck." }, { status: 500 });
  }
}, "DELETE /api/projects/[id]");
