import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireAuth } from "@/lib/auth";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { deckNameSchema, firstIssueMessage } from "@/lib/projects/deck-name";
import { parseGenerationSettings, type GenerationSettings } from "@deephaus/shared";

const createSchema = z.object(
  {
    name: deckNameSchema,
    // Defaults to `name`; the two stay in sync, as on rename.
    deck_name: deckNameSchema.optional(),
    settings: z.record(z.unknown()).optional(),
  },
  {
    required_error: "Send a JSON object with a deck name.",
    invalid_type_error: "Send a JSON object with a deck name.",
  },
);

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user!.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[GET /api/projects]", error);
    return NextResponse.json({ error: "Could not load decks." }, { status: 500 });
  }
  return NextResponse.json(data);
}, "GET /api/projects");

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireAuth({ patScope: "write" });
  if (response) return response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "Invalid deck.") },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const globalDefaults = await loadGlobalStudySettings(supabase, user!.id);
  let settings: GenerationSettings;
  try {
    settings = parseGenerationSettings({
      cardMix: "basic",
      detailLevel: "medium",
      desiredRetention: globalDefaults.desiredRetention,
      newCardsPerDay: globalDefaults.newCardsPerDay,
      useGlobalFsrsSettings: true,
      ...body.settings,
    });
  } catch {
    return NextResponse.json({ error: "Deck settings are invalid." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user!.id,
      name: body.name,
      deck_name: body.deck_name ?? body.name,
      settings,
    })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/projects]", error);
    return NextResponse.json({ error: "Could not create the deck." }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}, "POST /api/projects");
