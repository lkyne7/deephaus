import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { fetchYouTubeTranscript } from "@/lib/youtube/transcript";
import { normalizeYouTubeUrl } from "@/lib/youtube/parse";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  project_id: z.string().uuid(),
  url: z.string().min(1),
  raw_text: z.string().min(1).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Persist a YouTube video source from its caption transcript. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid request body";
    return jsonError(message ?? "Invalid request body", 400);
  }

  const canonicalUrl = normalizeYouTubeUrl(body.url);
  if (!canonicalUrl) {
    return jsonError("Enter a valid YouTube link.", 400);
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return jsonError("Project not found", 404);
  }

  let transcriptText = body.raw_text?.trim() ?? "";
  let segmentCount: number | null = null;

  if (!transcriptText) {
    try {
      const fetched = await fetchYouTubeTranscript(body.url);
      transcriptText = fetched.text;
      segmentCount = fetched.segmentCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch YouTube captions";
      return jsonError(message, 422);
    }
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: body.project_id,
      type: "youtube",
      raw_text: transcriptText,
      storage_path: canonicalUrl,
      page_count: segmentCount,
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  return NextResponse.json(data, { status: 201 });
}, "POST /api/sources/youtube");
