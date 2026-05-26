import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_SOURCE_FILE_BYTES, MAX_VIDEO_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { buildSourceChunks, toChunkPreviews } from "@/lib/sources/chunks";
import { extractSourceFromFile } from "@/lib/sources/extract-source";
import {
  detectSourceType,
  maxBytesForSourceType,
} from "@/lib/sources/file-types";
import { fetchYouTubeTranscript } from "@/lib/youtube/transcript";

const textBodySchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
});

const youtubeBodySchema = z.object({
  type: z.literal("youtube"),
  url: z.string().min(1),
});

/** Preview chunk segments for the create flow without persisting a source. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required." }, { status: 400 });
      }

      const sourceType = detectSourceType(file.name, file.type);
      if (!sourceType || sourceType === "text") {
        return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
      }

      const maxBytes = maxBytesForSourceType(sourceType);
      if (file.size > maxBytes) {
        const limitMb = Math.round(maxBytes / (1024 * 1024));
        return NextResponse.json({ error: `File is too large (max ${limitMb} MB).` }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractSourceFromFile(buffer, file.name, file.type);
      const chunks = buildSourceChunks(extracted.sourceType, extracted.text);

      return NextResponse.json({
        source_type: extracted.sourceType,
        page_count: extracted.pageCount,
        char_count: extracted.text.length,
        raw_text: extracted.text,
        chunks: toChunkPreviews(chunks),
      });
    }

    const body = z.union([textBodySchema, youtubeBodySchema]).parse(await request.json());

    if (body.type === "youtube") {
      const fetched = await fetchYouTubeTranscript(body.url);
      const chunks = buildSourceChunks("youtube", fetched.text);

      return NextResponse.json({
        source_type: "youtube" as const,
        video_id: fetched.videoId,
        page_count: fetched.segmentCount,
        char_count: fetched.text.length,
        raw_text: fetched.text,
        chunks: toChunkPreviews(chunks),
      });
    }

    const chunks = buildSourceChunks("text", body.text);

    return NextResponse.json({
      source_type: "text" as const,
      page_count: null,
      char_count: body.text.length,
      raw_text: body.text,
      chunks: toChunkPreviews(chunks),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not preview source";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/preview");
