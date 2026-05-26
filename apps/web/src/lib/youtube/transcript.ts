import { YoutubeTranscript, YoutubeTranscriptError } from "youtube-transcript";
import { normalizeYouTubeUrl, parseYouTubeVideoId } from "@/lib/youtube/parse";

const MIN_TEXT_CHARS = 50;
const BLOCK_SECONDS = 45;

type TranscriptLine = {
  text: string;
  offset: number;
  duration: number;
};

export type YouTubeTranscriptResult = {
  videoId: string;
  url: string;
  text: string;
  segmentCount: number;
};

export async function fetchYouTubeTranscript(inputUrl: string): Promise<YouTubeTranscriptResult> {
  const url = normalizeYouTubeUrl(inputUrl);
  const videoId = parseYouTubeVideoId(inputUrl);
  if (!url || !videoId) {
    throw new Error("Enter a valid YouTube link (youtube.com/watch?v=… or youtu.be/…).");
  }

  let lines: TranscriptLine[];
  try {
    lines = await YoutubeTranscript.fetchTranscript(url);
  } catch (error) {
    throw new Error(friendlyYouTubeError(error, videoId));
  }

  const text = formatTranscript(lines);
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error("This video does not have enough caption text to generate cards.");
  }

  const segmentCount = text.split(/\n--- \d+:\d{2}(?::\d{2})? ---\n/).filter(Boolean).length;
  return { videoId, url, text, segmentCount };
}

function friendlyYouTubeError(error: unknown, videoId: string): string {
  if (error instanceof YoutubeTranscriptError) {
    const message = error.message.replace(/^\[YoutubeTranscript\] 🚨\s*/, "");
    if (/transcript is disabled|no transcripts are available/i.test(message)) {
      return "This video has no captions. Try a video with subtitles enabled, upload the file, or paste a transcript as text.";
    }
    if (/too many requests|captcha/i.test(message)) {
      return "YouTube is rate-limiting requests. Wait a moment and try again.";
    }
    if (/no longer available/i.test(message)) {
      return "This video is unavailable or private.";
    }
    return message;
  }
  return `Could not fetch captions for this video (${videoId}).`;
}

function formatTranscript(lines: TranscriptLine[]): string {
  if (lines.length === 0) return "";

  const usesMilliseconds = lines.some((line) => line.duration > 50);
  const toSeconds = (offset: number) => (usesMilliseconds ? offset / 1000 : offset);

  const blocks: Array<{ start: number; parts: string[] }> = [];
  let current: { start: number; parts: string[] } | null = null;

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const start = toSeconds(line.offset);
    if (!current || start - current.start >= BLOCK_SECONDS) {
      if (current) blocks.push(current);
      current = { start, parts: [text] };
    } else {
      current.parts.push(text);
    }
  }
  if (current) blocks.push(current);

  return blocks
    .map((block) => `--- ${formatTimestamp(block.start)} ---\n\n${block.parts.join(" ")}`)
    .join("\n\n");
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
