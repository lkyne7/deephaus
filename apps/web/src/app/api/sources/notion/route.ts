import { NextResponse } from "next/server";
import { z } from "zod";
import { generationSettingsPartialSchema } from "@deephaus/shared";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  aiCreditsExhaustedResponse,
  isAiCreditsExhaustedError,
} from "@/lib/credits/service";
import { requirePlan } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { notionErrorResponse } from "@/lib/notion/api-errors";
import { importNotionPageDoc } from "@/lib/notion/blocks-to-doc";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromJson,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";

export const maxDuration = 300;

const bodySchema = z
  .object({
    project_id: z.string().uuid(),
    page_id: z.string().min(1),
    generate: z.boolean().optional(),
    settings: generationSettingsPartialSchema.optional(),
    chunk_indices: z.array(z.number().int().min(0)).optional(),
  })
  .passthrough();

/**
 * POST /api/sources/notion — import a Notion page as a source. The page's
 * block tree becomes the editable document (edited_content) and its plain text
 * drives chunking/generation, mirroring the file/YouTube source pattern
 * (storage_path holds the external Notion URL).
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const upgrade = await requirePlan(user!.id, "plus", "Notion imports");
  if (upgrade) return upgrade;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid request body";
    return NextResponse.json({ error: message ?? "Invalid request body" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { generate, options: generationOptions } = parseGenerationOptionsFromJson(body);
  const sourceId = crypto.randomUUID();

  try {
    const { doc, page } = await importNotionPageDoc({
      userId: user!.id,
      pageId: body.page_id,
      supabase,
      sourceId,
    });

    const rawText = sourceDocToPlainText(doc);
    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "That Notion page has no readable text to generate cards from." },
        { status: 422 },
      );
    }

    const { data, error } = await supabase
      .from("sources")
      .insert({
        id: sourceId,
        user_id: user!.id,
        project_id: body.project_id,
        type: "notion",
        title: page.title,
        raw_text: rawText,
        storage_path: page.url,
        edited_content: doc,
        content_edited_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!generate) {
      return NextResponse.json(data, { status: 201 });
    }

    const generation = await runSourceGeneration(supabase, user!.id, data.id, generationOptions);
    return NextResponse.json({ ...data, ...generation }, { status: 201 });
  } catch (error) {
    if (isAiCreditsExhaustedError(error)) {
      return aiCreditsExhaustedResponse(error);
    }
    if (error instanceof GenerationCapacityError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    const mapped = notionErrorResponse(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : "Could not import the Notion page.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/notion");
