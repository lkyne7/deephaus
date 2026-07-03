import { NextResponse } from "next/server";
import { z } from "zod";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notionErrorResponse } from "@/lib/notion/api-errors";
import { importNotionPageDoc } from "@/lib/notion/blocks-to-doc";

export const maxDuration = 120;

const bodySchema = z.object({
  project_id: z.string().uuid(),
  page_id: z.string().min(1),
});

/**
 * POST /api/sources/notion — import a Notion page as a source. The page's
 * block tree becomes the editable document (edited_content) and its plain text
 * drives chunking/generation, mirroring the file/YouTube source pattern
 * (storage_path holds the external Notion URL).
 */
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
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Pre-generate the source id so imported images land under its media path.
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
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const mapped = notionErrorResponse(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : "Could not import the Notion page.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/notion");
