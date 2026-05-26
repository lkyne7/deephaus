import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { mergeSettings } from "@/lib/fsrs/settings";

export async function GET(
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

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  deck_name: z.string().min(1).max(120).optional(),
  settings: z
    .object({
      desiredRetention: z.number().min(0.7).max(0.97).optional(),
      newCardsPerDay: z.number().int().min(0).max(200).optional(),
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
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
