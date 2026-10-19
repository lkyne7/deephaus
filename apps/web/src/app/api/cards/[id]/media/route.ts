import { NextResponse } from "next/server";
import {
  CARD_AUDIO_MIME_TYPES,
  CARD_IMAGE_MIME_TYPES,
  cardAudioSizeError,
  MAX_CARD_IMAGE_BYTES,
} from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeFileName(name: string, fallback: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

type MediaKind = "image" | "audio";

/** Validate an upload as a card image or audio clip; returns an error message when rejected. */
function validateMedia(file: File): { kind: MediaKind } | { error: string } {
  const type = file.type.toLowerCase();
  if (type.startsWith("audio/")) {
    if (!CARD_AUDIO_MIME_TYPES.includes(type as (typeof CARD_AUDIO_MIME_TYPES)[number])) {
      return { error: "Unsupported audio type. Use MP3, M4A/AAC, OGG, WAV, or WebM." };
    }
    const sizeError = cardAudioSizeError(file.size);
    if (sizeError) return { error: sizeError };
    return { kind: "audio" };
  }
  if (!CARD_IMAGE_MIME_TYPES.includes(type as (typeof CARD_IMAGE_MIME_TYPES)[number])) {
    return { error: "Unsupported file type. Use JPEG, PNG, WebP, or GIF images, or an MP3, M4A, OGG, WAV, or WebM audio clip." };
  }
  if (file.size > MAX_CARD_IMAGE_BYTES) {
    return { error: `Image exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB uploaded).` };
  }
  return { kind: "image" };
}

async function assertCardOwner(supabase: Awaited<ReturnType<typeof createClient>>, cardId: string, userId: string) {
  const { data } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .single();

  return Boolean(data);
}

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: cardId } = await params;
  const supabase = await createClient();

  if (!(await assertCardOwner(supabase, cardId, user!.id))) {
    return jsonError("Card not found", 404);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("file is required", 400);
  }

  const validated = validateMedia(file);
  if ("error" in validated) return jsonError(validated.error, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${user!.id}/${cardId}/${Date.now()}-${safeFileName(file.name, validated.kind)}`;

  const { error: uploadError } = await supabase.storage
    .from("card-media")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
      // Unique per-upload paths, so cache for a year (vs the 1-hour default).
      cacheControl: "31536000",
    });

  if (uploadError) {
    return jsonError(uploadError.message, 500);
  }

  const { data: urlData } = supabase.storage.from("card-media").getPublicUrl(storagePath);

  return NextResponse.json(
    {
      url: urlData.publicUrl,
      path: storagePath,
      kind: validated.kind,
    },
    { status: 201 },
  );
}, "POST /api/cards/[id]/media");
