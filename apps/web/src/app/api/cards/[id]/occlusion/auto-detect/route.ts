import { NextResponse } from "next/server";
import {
  imageUrlForOcclusionSetup,
  isSupabaseCardMediaUrl,
  normalizeOcclusionRect,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { detectOcclusionRectsByOcr } from "@/lib/occlusion/ocr";
import { reconcileOcclusionStudyReviews } from "@/lib/occlusion/reconcile-reviews";
import { createClient } from "@/lib/supabase/server";

// OCR (tesseract.js) needs the Node runtime and a little headroom to run.
export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_FETCH_TIMEOUT_MS = 15_000;

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  let draftOcclusion: unknown;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "occlusion_data" in body) {
      draftOcclusion = (body as { occlusion_data?: unknown }).occlusion_data;
    }
  } catch {
    // Empty body is fine — use persisted card fields only.
  }

  const { data: card, error } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, occlusion_data, generation_jobs!inner(sources!inner(projects!inner(user_id)))",
    )
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const draftParsed = parseImageOcclusionData(draftOcclusion);
  const existing = parseImageOcclusionData(card.occlusion_data);
  const imageUrl =
    draftParsed?.imageUrl ??
    existing?.imageUrl ??
    imageUrlForOcclusionSetup({
      type: card.type as "basic" | "cloze" | "image-occlusion",
      front: card.front,
      back: card.back,
      cloze_text: card.cloze_text,
      extra: card.extra,
      occlusion_data: card.occlusion_data,
    });
  if (!imageUrl) {
    return NextResponse.json({ error: "Add an image to this card first." }, { status: 400 });
  }
  if (!isSupabaseCardMediaUrl(imageUrl, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return NextResponse.json({ error: "Auto-detect only supports uploaded card images." }, { status: 400 });
  }

  try {
    const imageRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: `Could not load the card image (${imageRes.status}).` },
        { status: 400 },
      );
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    const detected = await detectOcclusionRectsByOcr(imageBuffer);
    const rects = detected.map(normalizeOcclusionRect);
    // Auto-occlude returns a fresh detected set (replacing prior auto results),
    // but never wipes existing regions if OCR comes back empty.
    const occlusion_data: ImageOcclusionData = {
      imageUrl,
      rects: rects.length > 0 ? rects : (existing?.rects ?? []),
    };

    const { data: updated, error: updateError } = await supabase
      .from("cards")
      .update({
        type: "image-occlusion",
        occlusion_data,
        user_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("occlusion_data, type")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    try {
      await reconcileOcclusionStudyReviews(supabase, id, user!.id, occlusion_data);
    } catch (reconcileErr) {
      console.error("[occlusion/auto-detect] reconcile reviews:", reconcileErr);
    }

    return NextResponse.json({
      occlusion_data: updated?.occlusion_data ?? occlusion_data,
      type: updated?.type ?? "image-occlusion",
      added: rects.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-detect failed";
    console.error("[occlusion/auto-detect] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/cards/[id]/occlusion/auto-detect");
