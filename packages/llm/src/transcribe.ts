import OpenAI, { toFile } from "openai";

const MIN_TEXT_CHARS = 50;

type WhisperSegment = {
  start: number;
  text: string;
};

export async function transcribeMedia(
  buffer: Buffer,
  filename: string,
  options: { apiKey?: string; mock?: boolean } = {},
): Promise<{ text: string; segmentCount: number }> {
  const useMock = options.mock ?? !options.apiKey;

  if (useMock) {
    const mock = [
      "--- 0:00 ---",
      "",
      "This is a mock transcript used when OpenAI is not configured.",
      "",
      "--- 0:30 ---",
      "",
      "Upload a video with OPENAI_API_KEY set to generate cards from real speech.",
    ].join("\n");
    return { text: mock, segmentCount: 2 };
  }

  const openai = new OpenAI({ apiKey: options.apiKey! });
  const file = await toFile(buffer, filename);

  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
  });

  const transcript = response.text?.trim() ?? "";
  const segments = (response as { segments?: WhisperSegment[] }).segments ?? [];

  if (segments.length === 0) {
    if (transcript.length < MIN_TEXT_CHARS) {
      throw new Error("Could not transcribe enough speech from this video.");
    }
    return { text: transcript, segmentCount: 0 };
  }

  const parts = segments
    .map((segment) => {
      const body = segment.text?.trim();
      if (!body) return null;
      return `--- ${formatTimestamp(segment.start)} ---\n\n${body}`;
    })
    .filter(Boolean);

  const text = parts.join("\n\n");
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error("Could not transcribe enough speech from this video.");
  }

  return { text, segmentCount: parts.length };
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
