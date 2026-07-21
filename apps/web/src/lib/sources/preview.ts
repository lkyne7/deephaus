import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Best-effort enqueue of a LibreOffice PDF-preview conversion for a freshly
 * uploaded Office document, so the "Original" tab is usually ready before the
 * user first opens it. Failures are swallowed — the viewer retries lazily.
 */
export async function enqueueSourcePreviewJob(
  supabase: SupabaseClient,
  source: Record<string, unknown>,
): Promise<void> {
  const type = source.type;
  const storagePath = source.storage_path;
  if (type !== "docx" && type !== "pptx") return;
  if (typeof storagePath !== "string" || !storagePath || /^https?:\/\//i.test(storagePath)) {
    return;
  }
  try {
    await supabase.from("source_extraction_jobs").insert({
      source_id: source.id,
      kind: "preview",
      storage_path: storagePath,
      filename:
        (typeof source.title === "string" && source.title) ||
        storagePath.split("/").pop() ||
        "document",
      extract_images: false,
    });
  } catch {
    // Non-fatal: previews can be generated on demand from the viewer.
  }
}
