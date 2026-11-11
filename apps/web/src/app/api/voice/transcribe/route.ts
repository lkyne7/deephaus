import { NextResponse } from "next/server";
import { transcribeDictation } from "@deephaus/llm";
import { CARD_AUDIO_MIME_TYPES, MAX_CARD_AUDIO_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";

/** Extensions the transcription provider reads, by the MIME type a recorder reports. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};
const KNOWN_EXTENSIONS = new Set(Object.values(EXTENSION_BY_TYPE));

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** The extension to name the upload with, or null when it isn't audio we can read. */
function audioExtension(file: File): string | null {
  const type = file.type.toLowerCase().split(";")[0].trim();
  if (type && CARD_AUDIO_MIME_TYPES.includes(type as (typeof CARD_AUDIO_MIME_TYPES)[number])) {
    return EXTENSION_BY_TYPE[type] ?? null;
  }
  // Native recordings can arrive with no type; fall back to the file name.
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if ((!type || type === "application/octet-stream") && KNOWN_EXTENSIONS.has(extension)) return extension;
  return null;
}

/**
 * Turn a spoken prompt into text for the composer. Nothing is stored: the
 * recording is transcribed and discarded, and the user edits the text before
 * sending it.
 *
 *   POST /api/voice/transcribe  multipart { file }
 *   → 200 { text }
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { response } = await requireUser({ rateLimit: "costly" });
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the recording.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("file is required", 400);
  if (file.size === 0) return jsonError("The recording is empty.", 400);
  if (file.size > MAX_CARD_AUDIO_BYTES) {
    return jsonError("That recording is too long. Keep voice prompts under two minutes.", 413);
  }
  const extension = audioExtension(file);
  if (!extension) return jsonError("Unsupported recording format.", 415);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text } = await transcribeDictation(buffer, `voice-prompt.${extension}`, {
      apiKey: process.env.OPENAI_API_KEY,
      mock: process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY,
    });
    if (!text) return jsonError("We couldn't hear anything. Try again a little closer to the mic.", 422);
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[voice transcribe] failed", err);
    return jsonError("Could not transcribe the recording. Try again.", 502);
  }
}, "POST /api/voice/transcribe");
