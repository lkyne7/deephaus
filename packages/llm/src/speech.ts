import OpenAI from "openai";

/** OpenAI's instructable text-to-speech model; output is MP3. */
export const TTS_MODEL = "gpt-4o-mini-tts";

export type SpeechVoice =
  | "alloy"
  | "ash"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer";

export interface SynthesizeSpeechOptions {
  text: string;
  voice: SpeechVoice;
  /** Delivery guidance, e.g. the language and pace for a learner. */
  instructions?: string;
  apiKey?: string;
  mock?: boolean;
}

export interface SynthesizedSpeech {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
}

/** Guidance for a flashcard clip: clear, natural, in the field's language. */
export function speechInstructions(language?: string | null): string {
  const base = "Read the text exactly as written, clearly and at a natural pace for a language learner. Do not add anything.";
  const trimmed = language?.trim();
  return trimmed ? `${base} The text is in ${trimmed}; use native pronunciation.` : base;
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

export async function synthesizeSpeech(options: SynthesizeSpeechOptions): Promise<SynthesizedSpeech> {
  const useMock = options.mock ?? !options.apiKey;
  if (useMock) return createMockSpeech();

  const openai = new OpenAI({ apiKey: options.apiKey! });
  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: options.voice,
    input: options.text,
    instructions: options.instructions,
    response_format: "mp3",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("The speech service returned no audio.");
  return { bytes, mimeType: "audio/mpeg" };
}
