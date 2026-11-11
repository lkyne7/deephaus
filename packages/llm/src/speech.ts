/**
 * Read-aloud clips through ElevenLabs text-to-speech. Output is MP3.
 * (OpenAI's gpt-4o-mini-tts shuts down January 6, 2027.)
 */
export const TTS_MODEL = "eleven_v4_turbo";

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const OUTPUT_FORMAT = "mp3_44100_128";

/** DeepHaus voice names → ElevenLabs premade voice IDs. */
export const ELEVENLABS_VOICE_IDS = {
  sarah: "EXAVITQu4vr4xnSDxMaL",
  matilda: "XrExE9yKIg1WjnnlVkGX",
  alice: "Xb7hH8MSUJpSbSDYk0k2",
  lily: "pFZP5JQG7iQjIQuC4Bku",
  brian: "nPczCjzI2devNBz1zQrb",
  eric: "cjVigY5qzO86Huf0OWal",
  george: "JBFqnCBsd6RMkjVDRZzb",
  daniel: "onwK4e9ZLuTAKqWW03F9",
} as const;

export type SpeechVoice = keyof typeof ELEVENLABS_VOICE_IDS;

export interface SynthesizeSpeechOptions {
  text: string;
  voice: SpeechVoice;
  /** ISO 639-1 code; the model detects the language when it's omitted. */
  languageCode?: string | null;
  apiKey?: string;
  mock?: boolean;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export interface SynthesizedSpeech {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
}

/** English names (and a few native ones) learners type for a field's language. */
const LANGUAGE_CODES: Record<string, string> = {
  afrikaans: "af", arabic: "ar", armenian: "hy", bengali: "bn", bulgarian: "bg",
  cantonese: "yue", catalan: "ca", chinese: "zh", mandarin: "zh", croatian: "hr",
  czech: "cs", danish: "da", dutch: "nl", english: "en", estonian: "et",
  filipino: "fil", tagalog: "fil", finnish: "fi", french: "fr", français: "fr",
  german: "de", deutsch: "de", greek: "el", hebrew: "he", hindi: "hi",
  hungarian: "hu", icelandic: "is", indonesian: "id", irish: "ga", italian: "it",
  italiano: "it", japanese: "ja", korean: "ko", latin: "la", latvian: "lv",
  lithuanian: "lt", malay: "ms", norwegian: "no", persian: "fa", farsi: "fa",
  polish: "pl", portuguese: "pt", português: "pt", romanian: "ro", russian: "ru",
  serbian: "sr", slovak: "sk", slovenian: "sl", spanish: "es", español: "es",
  swahili: "sw", swedish: "sv", tamil: "ta", thai: "th", turkish: "tr",
  ukrainian: "uk", urdu: "ur", vietnamese: "vi", welsh: "cy",
};

/**
 * The language code for what a learner typed ("French", "fr", "pt-BR"), or
 * null to let the model detect the language.
 */
export function speechLanguageCode(language?: string | null): string | null {
  const trimmed = language?.trim().toLowerCase();
  if (!trimmed) return null;
  const named = LANGUAGE_CODES[trimmed] ?? LANGUAGE_CODES[trimmed.split(/[\s(]/)[0] ?? ""];
  if (named) return named;
  const code = /^([a-z]{2,3})(?:[-_][a-z0-9]+)?$/.exec(trimmed)?.[1];
  return code ?? null;
}

/**
 * A minimal MPEG-1 Layer III frame (128 kbps, 44.1 kHz, no padding) repeated
 * for a short silent clip. Lets development and tests exercise the whole
 * flow without the API.
 */
export function createMockSpeech(): SynthesizedSpeech {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const frames = 10;
  const bytes = new Uint8Array(frame.length * frames);
  for (let i = 0; i < frames; i++) bytes.set(frame, i * frame.length);
  return { bytes, mimeType: "audio/mpeg" };
}

/** A short, safe reason from an ElevenLabs error body (never the request). */
async function providerError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: { message?: string; status?: string } | string };
    detail = typeof body.detail === "string" ? body.detail : (body.detail?.message ?? body.detail?.status ?? "");
  } catch {
    // Not JSON.
  }
  if (response.status === 401) return "The speech service rejected the API key.";
  if (response.status === 429) return "The speech service is busy. Try again in a moment.";
  return `The speech service failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : "."}`;
}

export async function synthesizeSpeech(options: SynthesizeSpeechOptions): Promise<SynthesizedSpeech> {
  const useMock = options.mock ?? !options.apiKey;
  if (useMock) return createMockSpeech();

  const voiceId = ELEVENLABS_VOICE_IDS[options.voice] ?? ELEVENLABS_VOICE_IDS.sarah;
  const body: Record<string, unknown> = { text: options.text, model_id: TTS_MODEL };
  if (options.languageCode) body.language_code = options.languageCode;

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${ELEVENLABS_TTS_URL}/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: {
      "xi-api-key": options.apiKey!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await providerError(response));

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("The speech service returned no audio.");
  return { bytes, mimeType: "audio/mpeg" };
}
