import { NextResponse } from "next/server";
import { z } from "zod";
import { parseGenerationSettings } from "@deephaus/shared";
import { requireAuth } from "@/lib/auth";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import {
  MAX_QUIZLET_IMPORT_BYTES,
  MAX_QUIZLET_IMPORT_CARDS,
  parseQuizletExport,
} from "@/lib/import/quizlet";
import { withApiTiming } from "@/lib/perf/with-api-timing";

export const runtime = "nodejs";
export const maxDuration = 60;

const CARD_INSERT_CHUNK = 500;

const importSchema = z.object({
  content: z.string().min(1),
  deck_name: z.string().trim().min(1).max(120).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function richText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r?\n/g, "<br>");
}

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  let body: z.infer<typeof importSchema>;
  try {
    body = importSchema.parse(await request.json());
  } catch {
    return jsonError("Provide a Quizlet export and an optional deck name.", 400);
  }

  if (new TextEncoder().encode(body.content).byteLength > MAX_QUIZLET_IMPORT_BYTES) {
    return jsonError("Quizlet exports must be 5 MB or smaller.", 413);
  }

  const cards = parseQuizletExport(body.content);
  if (cards.length === 0) {
    return jsonError(
      "No cards found. Export from Quizlet with a tab between each term and definition and a new line between cards.",
      422,
    );
  }
  if (cards.length > MAX_QUIZLET_IMPORT_CARDS) {
    return jsonError(`Quizlet imports are limited to ${MAX_QUIZLET_IMPORT_CARDS.toLocaleString()} cards.`, 413);
  }

  const deckName = body.deck_name || "Quizlet import";
  let projectId: string | null = null;

  try {
    const globalDefaults = await loadGlobalStudySettings(supabase, user!.id);
    const settings = parseGenerationSettings({
      cardMix: "basic",
      detailLevel: "medium",
      desiredRetention: globalDefaults.desiredRetention,
      newCardsPerDay: globalDefaults.newCardsPerDay,
      useGlobalFsrsSettings: true,
    });

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        user_id: user!.id,
        name: deckName,
        deck_name: deckName,
        settings,
      })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(projectError?.message ?? "Could not create the deck.");
    }
    projectId = project.id;

    const { data: source, error: sourceError } = await supabase
      .from("sources")
      .insert({
        project_id: project.id,
        type: "text",
        raw_text: "Imported from Quizlet",
      })
      .select("id")
      .single();
    if (sourceError || !source) {
      throw new Error(sourceError?.message ?? "Could not create the Quizlet source.");
    }

    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .insert({ source_id: source.id, status: "ready", progress: 100 })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create the import job.");
    }

    for (let offset = 0; offset < cards.length; offset += CARD_INSERT_CHUNK) {
      const rows = cards.slice(offset, offset + CARD_INSERT_CHUNK).map((card, index) => ({
        job_id: job.id,
        type: "basic" as const,
        front: richText(card.term),
        back: richText(card.definition),
        cloze_text: null,
        extra: null,
        tags: [],
        sort_order: offset + index,
      }));
      const { error } = await supabase.from("cards").insert(rows);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json(
      {
        decks: [{ id: project.id, name: deckName, cardCount: cards.length }],
        cardsImported: cards.length,
        scheduledImported: 0,
        suspendedImported: 0,
        mediaImported: 0,
        mediaSkipped: 0,
        fsrsPresetsApplied: 0,
      },
      { status: 201 },
    );
  } catch (error) {
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId).eq("user_id", user!.id);
    }
    console.error("[POST /api/import/quizlet]", error);
    return jsonError(error instanceof Error ? error.message : "Quizlet import failed.", 500);
  }
}, "POST /api/import/quizlet");
