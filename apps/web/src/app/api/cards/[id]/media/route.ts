import { NextResponse } from "next/server";
import { CARD_IMAGE_MIME_TYPES, MAX_CARD_IMAGE_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
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

  if (file.size > MAX_CARD_IMAGE_BYTES) {
    return jsonError(
      `Image exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB uploaded).`,
      400,
    );
  }

  if (!CARD_IMAGE_MIME_TYPES.includes(file.type as (typeof CARD_IMAGE_MIME_TYPES)[number])) {
    return jsonError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${user!.id}/${cardId}/${Date.now()}-${safeFileName(file.name)}`;

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
    },
    { status: 201 },
  );
}, "POST /api/cards/[id]/media");
