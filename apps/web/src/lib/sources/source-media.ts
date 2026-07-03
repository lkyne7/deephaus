import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Reuse the public card-media bucket for inline source images (same privacy posture). */
const MEDIA_BUCKET = "card-media";

export function extensionForMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  return "png";
}

/**
 * Upload an extracted source image to public storage and return its URL.
 * Best-effort: returns null on failure so document building never aborts.
 */
export async function uploadSourceMedia(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  name: string,
  bytes: Buffer,
  mime: string,
): Promise<string | null> {
  const path = `${userId}/source-media/${sourceId}/${name}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) {
    console.warn("[source-media] upload failed:", error.message);
    return null;
  }
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
