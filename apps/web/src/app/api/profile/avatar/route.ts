import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Remove every stored avatar file for the user (uploads use unique names). */
async function removeExistingAvatars(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  const { data: files } = await service.storage.from("avatars").list(userId, { limit: 100 });
  if (files?.length) {
    await service.storage
      .from("avatars")
      .remove(files.map((file) => `${userId}/${file.name}`));
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

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
  if (file.size > MAX_AVATAR_BYTES) {
    return jsonError(
      `Image exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB uploaded).`,
      400,
    );
  }
  const extension = AVATAR_MIME_TYPES[file.type];
  if (!extension) {
    return jsonError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.", 400);
  }

  const service = createServiceClient();
  const storagePath = `${user!.id}/avatar-${Date.now()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await removeExistingAvatars(service, user!.id).catch(() => undefined);

  const { error: uploadError } = await service.storage
    .from("avatars")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    console.error("Avatar upload failed:", uploadError.message);
    return jsonError("Failed to upload profile picture", 500);
  }

  const { data: urlData } = service.storage.from("avatars").getPublicUrl(storagePath);

  const { error: updateError } = await service
    .from("user_profiles")
    .update({ avatar_url: urlData.publicUrl })
    .eq("user_id", user!.id);
  if (updateError) {
    console.error("Avatar profile update failed:", updateError.message);
    return jsonError("Failed to save profile picture", 500);
  }

  return NextResponse.json({ avatar_url: urlData.publicUrl }, { status: 201 });
}

export async function DELETE() {
  const { user, response } = await requireUser();
  if (response) return response;

  const service = createServiceClient();
  await removeExistingAvatars(service, user!.id).catch(() => undefined);

  const { error } = await service
    .from("user_profiles")
    .update({ avatar_url: null })
    .eq("user_id", user!.id);
  if (error) {
    console.error("Avatar removal failed:", error.message);
    return jsonError("Failed to remove profile picture", 500);
  }

  return NextResponse.json({ avatar_url: null });
}
