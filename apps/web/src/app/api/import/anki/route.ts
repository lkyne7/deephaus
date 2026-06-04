import { createReadStream } from "node:fs";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { parseApkg, parseApkgFromZip } from "@deephaus/apkg";
import { MAX_APKG_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FSRS_PARAM_COUNT } from "@/lib/fsrs/scheduler";
import { importAnkiPackage } from "@/lib/import/anki-import";
import { assertApkgStoragePathOwned } from "@/lib/import/apkg-import-constants";
import {
  downloadApkgToTempFile,
  removeApkgImportObject,
} from "@/lib/import/apkg-storage-server";

export const maxDuration = 300;
export const runtime = "nodejs";

const MAX_UPLOAD_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));
/** Packages above this must use direct-to-Supabase upload (Next body limits are much lower). */
const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type ImportBody = {
  storage_path?: string;
  deck_name?: string;
  scheduling?: boolean;
};

export const POST = withApiTiming(async function POST(request: Request) {
  let tempCleanup: (() => Promise<void>) | undefined;
  let storagePathToRemove: string | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;

  try {
    const { user, response } = await requireUser();
    if (response) return response;

    supabase = await createClient();
    const contentType = request.headers.get("content-type") ?? "";

    let deckNameOverride: string | undefined;
    let importScheduling = true;
    let parsed;
    let zip: JSZip | undefined;

    if (contentType.includes("application/json")) {
      let body: ImportBody;
      try {
        body = (await request.json()) as ImportBody;
      } catch {
        return jsonError("Invalid JSON body.", 400);
      }

      const storagePath = body.storage_path?.trim();
      if (!storagePath) {
        return jsonError("storage_path is required.", 400);
      }
      deckNameOverride = body.deck_name?.trim() || undefined;
      importScheduling = body.scheduling !== false;

      assertApkgStoragePathOwned(user!.id, storagePath);
      storagePathToRemove = storagePath;

      const downloaded = await downloadApkgToTempFile(supabase, storagePath);
      tempCleanup = downloaded.cleanup;

      zip = await JSZip.loadAsync(createReadStream(downloaded.path));
      parsed = await parseApkgFromZip(zip, {
        fsrsParamCount: FSRS_PARAM_COUNT,
        eagerMedia: false,
      });
    } else {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError(
          `Could not read the upload. For files over ${Math.round(DIRECT_UPLOAD_MAX_BYTES / (1024 * 1024))} MB, refresh the page and import again (large files upload via cloud storage).`,
          400,
        );
      }

      const file = form.get("file");
      deckNameOverride = (form.get("deck_name") as string | null)?.trim() || undefined;
      importScheduling = (form.get("scheduling") as string | null) !== "false";

      if (!(file instanceof File)) {
        return jsonError("file is required", 400);
      }
      if (!/\.(apkg|colpkg)$/i.test(file.name)) {
        return jsonError("Choose an Anki package (.apkg) file.", 400);
      }
      if (file.size > MAX_APKG_BYTES) {
        return jsonError(`File exceeds ${MAX_UPLOAD_GB} GB limit.`, 400);
      }
      if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
        return jsonError(
          `This file is too large for a direct upload (${(file.size / (1024 * 1024)).toFixed(0)} MB). Refresh the page and import again.`,
          413,
        );
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      parsed = await parseApkg(bytes, { fsrsParamCount: FSRS_PARAM_COUNT });
    }

    if (parsed.decks.length === 0 || parsed.stats.cardCount === 0) {
      return jsonError("No importable cards were found in this package.", 422);
    }

    const result = await importAnkiPackage(supabase, user!.id, parsed, {
      deckNameOverride,
      importScheduling,
      mediaZip: zip,
    });
    return NextResponse.json({ ...result, source: parsed.stats }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/import/anki]", error);
    const message = error instanceof Error ? error.message : "Import failed.";
    return jsonError(message, 500);
  } finally {
    try {
      if (tempCleanup) await tempCleanup();
      if (storagePathToRemove && supabase) {
        await removeApkgImportObject(supabase, storagePathToRemove);
      }
    } catch (cleanupError) {
      console.error("[POST /api/import/anki] cleanup failed", cleanupError);
    }
  }
}, "POST /api/import/anki");
