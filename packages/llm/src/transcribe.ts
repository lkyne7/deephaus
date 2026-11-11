import OpenAI, { toFile } from "openai";

const MIN_TEXT_CHARS = 50;

/**
 * OpenAI's speech-to-text model for recorded audio. whisper-1 shuts down on
 * 2027-02-26. gpt-transcribe returns plain text only (no timestamped
 * segments), handles a 27-minute lecture in one request, and takes a prompt.
 */
export const TRANSCRIBE_MODEL = "gpt-transcribe";

export async function transcribeMedia(
  buffer: Buffer,
  filename: string,
  options: { apiKey?: string; mock?: boolean } = {},
): Promise<{ text: string; segmentCount: number }> {
  const useMock = options.mock ?? !options.apiKey;

  if (useMock) {
    const mock = [
      "This is a mock transcript used when OpenAI is not configured.",
      "",
      "Upload a video with OPENAI_API_KEY set to generate cards from real speech.",
    ].join("\n");
    return { text: mock, segmentCount: 0 };
  }

  const openai = new OpenAI({ apiKey: options.apiKey! });
  const file = await toFile(buffer, filename);

  const response = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "json",
  });

  const text = response.text?.trim() ?? "";
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error("Could not transcribe enough speech from this video.");
  }
  // gpt-transcribe has no segments, so a video source reports no page count.
  return { text, segmentCount: 0 };
}

/** Words a voice prompt may lean on, so names like DeepHaus and Anki come back spelled right. */
const DICTATION_PROMPT =
  "A student is dictating instructions for making flashcards in DeepHaus, for example: Make 20 Anki cards on the Krebs cycle.";

/**
 * Transcribe a short spoken prompt to plain text: no timestamps, no minimum
 * length. Returns an empty string when nothing intelligible was said.
 */
export async function transcribeDictation(
  buffer: Buffer,
  filename: string,
  options: { apiKey?: string; mock?: boolean } = {},
): Promise<{ text: string }> {
  const useMock = options.mock ?? !options.apiKey;
  if (useMock) {
    return { text: "Make flashcards on the main ideas of photosynthesis." };
  }

  const openai = new OpenAI({ apiKey: options.apiKey! });
  const file = await toFile(buffer, filename);
  const response = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "json",
    prompt: DICTATION_PROMPT,
  });
  return { text: response.text?.trim() ?? "" };
}
