import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  ANKG_IMPORTS_BUCKET,
  APKG_BUCKET_MAX_BYTES,
  apkgImportStoragePath,
} from "@/lib/import/apkg-import-constants";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Reserve a storage path for a direct-to-Supabase .apkg upload (avoids Next body limits).
 *
 *   POST /api/import/anki/prepare   { "filename": "AnKing.apkg" }
 */
export const POST = withApiTiming(async function POST(request: Request) {
  try {
    const { user, response } = await requireUser();
    if (response) return response;

    let body: { filename?: string };
    try {
      body = (await request.json()) as { filename?: string };
    } catch {
      return jsonError("Invalid request body.", 400);
    }

    const filename = body.filename?.trim();
    if (!filename || !/\.(apkg|colpkg)$/i.test(filename)) {
      return jsonError("filename must end with .apkg or .colpkg", 400);
    }

    const importId = randomUUID();
    const storagePath = apkgImportStoragePath(user!.id, importId, filename);

    return NextResponse.json({
      bucket: ANKG_IMPORTS_BUCKET,
      storagePath,
      importId,
      maxApkgBytes: APKG_BUCKET_MAX_BYTES,
      // The apkg-imports bucket allows up to 10 GB, but Supabase also enforces a
      // separate *global* Storage file-size limit (Dashboard → Storage → Settings).
      // If that global cap is still at the default (~50 MB), uploads fail with
      // HTTP 413 before any bytes are sent — even though the bucket limit is higher.
      storageGlobalLimitHint:
        "If uploads fail with “Maximum size exceeded”, raise the Global file size limit under Supabase → Storage → Settings to at least 10 GB.",
    });
  } catch (error) {
    console.error("[POST /api/import/anki/prepare]", error);
    const message = error instanceof Error ? error.message : "Could not prepare import.";
    return jsonError(message, 500);
  }
}, "POST /api/import/anki/prepare");
