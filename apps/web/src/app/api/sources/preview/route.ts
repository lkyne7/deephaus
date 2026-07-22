import { NextResponse } from "next/server";
import { z } from "zod";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  getEffectivePlan,
  getPlanUploadLimit,
  requirePlan,
} from "@/lib/billing/access";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
} from "@/lib/credits/service";
import { createClient } from "@/lib/supabase/server";
import { notionErrorResponse } from "@/lib/notion/api-errors";
import { importNotionPageDoc } from "@/lib/notion/blocks-to-doc";
import { buildSourceChunks, toChunkPreviews } from "@/lib/sources/chunks";
import { extractSourceFromFile } from "@/lib/sources/extract-source";
import { buildDocumentSegmentPreviews } from "@/lib/sources/segment-thumbnails";
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

const notionBodySchema = z.object({
  type: z.literal("notion"),
  page_id: z.string().min(1),
});

/** Preview chunk segments for the create flow without persisting a source. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
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

      const plan = await getEffectivePlan(user!.id);
      const maxBytes = Math.min(
        maxBytesForSourceType(sourceType),
        getPlanUploadLimit(plan),
      );
      if (file.size > maxBytes) {
        const limitMb = Math.round(maxBytes / (1024 * 1024));
        return NextResponse.json({ error: `File is too large (max ${limitMb} MB).` }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractSourceFromFile(buffer, file.name, file.type, {
        creditContext: {
          userId: user!.id,
          idempotencyKey: creditIdempotencyKey(
            user!.id,
            "video-preview",
            request.headers.get("idempotency-key"),
          ),
        },
      });
      const builtChunks = buildSourceChunks(extracted.sourceType, extracted.text);
      const chunkPreviews = toChunkPreviews(builtChunks);
      const chunks = await buildDocumentSegmentPreviews(
        buffer,
        extracted.sourceType,
        chunkPreviews,
      );

      return NextResponse.json({
        source_type: extracted.sourceType,
        page_count: extracted.pageCount,
        char_count: extracted.text.length,
        raw_text: extracted.text,
        chunks,
      });
    }

    const body = z
      .union([textBodySchema, youtubeBodySchema, notionBodySchema])
      .parse(await request.json());

    if (body.type === "notion") {
      const upgrade = await requirePlan(user!.id, "plus", "Notion imports");
      if (upgrade) return upgrade;
      const { doc, page } = await importNotionPageDoc({
        userId: user!.id,
        pageId: body.page_id,
        supabase: await createClient(),
        sourceId: "preview",
        uploadImages: false,
      });
      const rawText = sourceDocToPlainText(doc);
      const chunks = buildSourceChunks("notion", rawText);

      return NextResponse.json({
        source_type: "notion" as const,
        title: page.title,
        page_url: page.url,
        page_count: null,
        char_count: rawText.length,
        raw_text: rawText,
        chunks: toChunkPreviews(chunks),
      });
    }

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
    if (isAiCreditsExhaustedError(error)) {
      return aiCreditsExhaustedResponse(error);
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const mapped = notionErrorResponse(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : "Could not preview source";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/preview");
