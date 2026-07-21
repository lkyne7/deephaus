import { NextResponse } from "next/server";
import { z } from "zod";
import { generationSettingsPartialSchema } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromJson,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";
import {
  WebsiteFetchError,
  fetchAndExtractWebsite,
} from "@/lib/websites/fetch-and-extract";

export const maxDuration = 60;

const bodySchema = z
  .object({
    project_id: z.string().uuid(),
    url: z.string().min(1).max(2_048),
    generate: z.boolean().optional(),
    settings: generationSettingsPartialSchema.optional(),
    chunk_indices: z.array(z.number().int().min(0)).optional(),
  })
  .passthrough();

/** Import one public webpage's main readable content as an editable source. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

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
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const extracted = await fetchAndExtractWebsite(body.url);
    const { data: source, error } = await supabase
      .from("sources")
      .insert({
        project_id: body.project_id,
        type: "website",
        title: extracted.title,
        raw_text: extracted.rawText,
        external_url: extracted.canonicalUrl,
        edited_content: extracted.doc,
        content_edited_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error || !source) {
      return NextResponse.json({ error: error?.message ?? "Could not save website." }, { status: 500 });
    }

    const { generate, options } = parseGenerationOptionsFromJson(body);
    if (!generate) return NextResponse.json(source, { status: 201 });

    const generation = await runSourceGeneration(supabase, user!.id, source.id, options);
    return NextResponse.json({ ...source, ...generation }, { status: 201 });
  } catch (error) {
    if (error instanceof WebsiteFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof GenerationCapacityError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "Could not import website.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/website");
