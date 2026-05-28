import { NextResponse } from "next/server";
import { parseApkg } from "@deephaus/apkg";
import { MAX_APKG_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FSRS_PARAM_COUNT } from "@/lib/fsrs/scheduler";
import { importAnkiPackage } from "@/lib/import/anki-import";

export const maxDuration = 300;

const MAX_UPLOAD_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Import an Anki deck (.apkg) for the current user: creates decks, cards, and
 * per-card FSRS scheduling state, plus any deck-level FSRS preset.
 *
 *   POST /api/import/anki   (multipart: file, deck_name?, scheduling?)
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(`Could not read the upload. Keep the file under ${MAX_UPLOAD_GB} GB.`, 400);
  }

  const file = form.get("file");
  const deckNameOverride = (form.get("deck_name") as string | null)?.trim() || undefined;
  const importScheduling = (form.get("scheduling") as string | null) !== "false";

  if (!(file instanceof File)) {
    return jsonError("file is required", 400);
  }
  if (!/\.(apkg|colpkg)$/i.test(file.name)) {
    return jsonError("Choose an Anki package (.apkg) file.", 400);
  }
  if (file.size > MAX_APKG_BYTES) {
    return jsonError(`File exceeds ${MAX_UPLOAD_GB} GB limit.`, 400);
  }

  let parsed;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    parsed = await parseApkg(bytes, { fsrsParamCount: FSRS_PARAM_COUNT });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the Anki package.";
    return jsonError(message, 422);
  }

  if (parsed.decks.length === 0 || parsed.stats.cardCount === 0) {
    return jsonError("No importable cards were found in this package.", 422);
  }

  const supabase = await createClient();

  try {
    const result = await importAnkiPackage(supabase, user!.id, parsed, {
      deckNameOverride,
      importScheduling,
    });
    return NextResponse.json({ ...result, source: parsed.stats }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    return jsonError(message, 500);
  }
}, "POST /api/import/anki");
