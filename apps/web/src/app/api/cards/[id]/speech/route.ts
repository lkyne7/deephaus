import { NextResponse } from "next/server";
import { speechInstructions, synthesizeSpeech } from "@deephaus/llm";
import {
  DEFAULT_TTS_VOICE,
  MAX_TTS_CHARS,
  TTS_VOICES,
  cardTextForSpeech,
  type TtsVoice,
} from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";
import { createClient } from "@/lib/supabase/server";

/** One credit per started thousand characters of spoken text. */
export function speechCredits(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1000));
}

type SpeechBody = {
  text?: string;
  voice?: string;
  language?: string;
  title?: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Generate a spoken clip for card text and store it as card media.
 *
 *   POST /api/cards/[id]/speech  { text, voice?, language?, title? }
 *   → 201 { url, path, title, characters, credits }
 *
 * The client inserts the clip into the field, exactly like an uploaded file.
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser({ rateLimit: "costly" });
  if (response) return response;

  const { id: cardId } = await params;
  let body: SpeechBody;
  try {
    body = (await request.json()) as SpeechBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const text = cardTextForSpeech(typeof body.text === "string" ? body.text : "");
  if (!text) return jsonError("There is no text to read aloud.", 400);
  if (text.length > MAX_TTS_CHARS) {
    return jsonError(`Text is too long for one clip (${text.length} of ${MAX_TTS_CHARS} characters). Shorten it and try again.`, 400);
  }
  const voice: TtsVoice = TTS_VOICES.some((candidate) => candidate.id === body.voice)
    ? (body.voice as TtsVoice)
    : DEFAULT_TTS_VOICE;
  const language = typeof body.language === "string" ? body.language.trim().slice(0, 40) : "";
  const title = (typeof body.title === "string" ? body.title.trim().slice(0, 80) : "") || "Pronunciation";

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();
  if (!card) return jsonError("Card not found", 404);

  const useMock = process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;
  const credits = speechCredits(text);
  const idempotencyKey = creditIdempotencyKey(
    user!.id,
    `card-tts:${cardId}`,
    request.headers.get("idempotency-key"),
  );
  let reserved = false;

  try {
    if (!useMock) {
      await reserveAiCredits({
        userId: user!.id,
        idempotencyKey,
        action: "card-tts",
        reservedCredits: credits,
        resourceType: "card",
        resourceId: cardId,
        metadata: { voice, characters: text.length, language: language || null },
      });
      reserved = true;
    }

    const speech = await synthesizeSpeech({
      text,
      voice,
      instructions: speechInstructions(language),
      apiKey: process.env.OPENAI_API_KEY,
      mock: useMock,
    });

    const storagePath = `${user!.id}/${cardId}/${Date.now()}-speech.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("card-media")
      .upload(storagePath, Buffer.from(speech.bytes), {
        contentType: speech.mimeType,
        upsert: false,
        cacheControl: "31536000",
      });
    if (uploadError) throw new Error(uploadError.message);
    const { data: urlData } = supabase.storage.from("card-media").getPublicUrl(storagePath);

    if (reserved) {
      await settleAiCredits({ userId: user!.id, idempotencyKey, chargedCredits: credits });
    }
    return NextResponse.json(
      { url: urlData.publicUrl, path: storagePath, title, characters: text.length, credits: useMock ? 0 : credits },
      { status: 201 },
    );
  } catch (err) {
    if (reserved) {
      try {
        await releaseAiCredits({ userId: user!.id, idempotencyKey });
      } catch (releaseError) {
        console.error("[card speech credits] failed to release reservation", releaseError);
      }
    }
    if (isAiCreditsExhaustedError(err)) {
      return aiCreditsExhaustedResponse(err);
    }
    const message = err instanceof Error ? err.message : "Failed to generate speech";
    return jsonError(message, 500);
  }
}, "POST /api/cards/[id]/speech");
