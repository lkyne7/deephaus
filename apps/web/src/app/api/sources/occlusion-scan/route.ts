import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { detectSourceType, maxBytesForSourceType } from "@/lib/sources/file-types";
import { scanForOcclusion, supportsOcclusion } from "@/lib/occlusion/scan";

export const maxDuration = 120;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Estimate how many images in an uploaded document qualify for auto image
 * occlusion (OCR-readable labels). Stateless: the file is scanned in-memory and
 * never persisted. Used by the create flow before generation.
 *
 * POST /api/sources/occlusion-scan  (multipart: file)
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("A file is required.", 400);
  }

  const sourceType = detectSourceType(file.name, file.type);
  if (!sourceType || !supportsOcclusion(sourceType)) {
    return NextResponse.json({ scanned: 0, qualified: 0, items: [] });
  }

  const maxBytes = maxBytesForSourceType(sourceType);
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return jsonError(`File is too large (max ${limitMb} MB).`, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await scanForOcclusion(buffer, sourceType);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not scan document for diagrams";
    return jsonError(message, 422);
  }
}, "POST /api/sources/occlusion-scan");
